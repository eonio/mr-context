// src/agent/agent.ts
// MrcAgent — coordinates VS Code LM API, semantic graph, skill routing, and tool loop.
// This file imports from 'vscode' and must only be used in extension context.

import * as vscode from "vscode";
import type { SemanticGraph, MrcConfig } from "../shared/types.js";
import { GRAPH_PATH } from "../shared/config.js";
import { loadOrBuildGraph, saveGraph, enrichNodes } from "../graph/index.js";
import { queryGraph, buildScorer } from "../graph/query.js";
import { detectSkill, buildSkillPrompt } from "./skills.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import type { SkillName } from "./skills.js";
import type { ToolName } from "./tools.js";

interface CacheEntry { nodes: SemanticNode[]; timestamp: number; }
// Avoid circular import — re-declare type locally
type SemanticNode = import("../shared/types.js").SemanticNode;

export class MrcAgent {
  private model: vscode.LanguageModelChat | null = null;
  private graph: SemanticGraph | null = null;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly config: MrcConfig) {}

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(token: vscode.CancellationToken): Promise<void> {
    this.model = await this.selectModel();
    this.graph = await loadOrBuildGraph(this.config);

    const unenriched = this.graph.nodes.filter((n) => !n.summary).length;
    if (unenriched > 0 && !token.isCancellationRequested) {
      await this.runEnrichment(token);
    }
  }

  private async selectModel(): Promise<vscode.LanguageModelChat> {
    const families = ["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"];
    for (const family of families) {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot", family });
      if (models.length > 0) return models[0];
    }
    const any = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (any.length > 0) return any[0];
    throw new Error(
      "No GitHub Copilot models found. Install the GitHub Copilot extension and sign in."
    );
  }

  private async runEnrichment(token: vscode.CancellationToken): Promise<void> {
    if (!this.model || !this.graph) return;
    const model = this.model;

    const provider = async (prompt: string): Promise<string> => {
      if (token.isCancellationRequested) return "";
      const msgs = [vscode.LanguageModelChatMessage.User(prompt)];
      const res = await model.sendRequest(msgs, {}, token);
      let text = "";
      for await (const part of res.stream) {
        if (part instanceof vscode.LanguageModelTextPart) text += part.value;
      }
      return text;
    };

    this.graph.nodes = await enrichNodes(this.graph.nodes, provider);
    saveGraph(this.graph, this.config.graphCachePath ?? GRAPH_PATH);
  }

  // ---------------------------------------------------------------------------
  // Context retrieval
  // ---------------------------------------------------------------------------

  async getContext(query: string, topK?: number): Promise<SemanticNode[]> {
    if (!this.graph || !this.model) throw new Error("Agent not initialized.");
    const k = this.adaptiveTopK(topK ?? this.config.maxContextNodes ?? 25);
    const key = `${query}::${k}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) return cached.nodes;

    const model = this.model;
    const cts = new vscode.CancellationTokenSource();
    const scorer = buildScorer(async (prompt) => {
      const msgs = [vscode.LanguageModelChatMessage.User(prompt)];
      const res = await model.sendRequest(msgs, {}, cts.token);
      let t = "";
      for await (const p of res.stream) {
        if (p instanceof vscode.LanguageModelTextPart) t += p.value;
      }
      cts.dispose();
      return t;
    });

    const nodes = await queryGraph(this.graph, query, k, scorer);
    this.cache.set(key, { nodes, timestamp: Date.now() });
    return nodes;
  }

  private adaptiveTopK(base: number): number {
    if (!this.model) return base;
    const budget = (this.model.maxInputTokens ?? 8192) - 3500;
    return Math.min(base, Math.floor(budget / 200), 50);
  }

  // ---------------------------------------------------------------------------
  // Chat — streaming AsyncGenerator
  // ---------------------------------------------------------------------------

  async *chat(
    userMessage: string,
    token: vscode.CancellationToken,
    command?: string
  ): AsyncGenerator<string> {
    if (!this.model || !this.graph) throw new Error("Agent not initialized.");

    const skill = detectSkill(userMessage, command) as SkillName;
    const contextNodes = await this.getContext(userMessage);
    const systemPrompt = buildSkillPrompt(skill, contextNodes);

    const tools: vscode.LanguageModelChatTool[] = TOOL_DEFINITIONS.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    }));

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(userMessage),
    ];

    yield* this.toolLoop(messages, tools, token);
  }

  // ---------------------------------------------------------------------------
  // Tool loop
  // ---------------------------------------------------------------------------

  private async *toolLoop(
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelChatTool[],
    token: vscode.CancellationToken,
    maxIterations = 5
  ): AsyncGenerator<string> {
    for (let i = 0; i < maxIterations; i++) {
      if (token.isCancellationRequested) return;

      let response: vscode.LanguageModelChatResponse;
      try {
        response = await this.model!.sendRequest(messages, { tools }, token);
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          yield `**Error:** ${err.message}`;
        } else {
          throw err;
        }
        return;
      }

      const textParts: vscode.LanguageModelTextPart[] = [];
      const toolCalls: vscode.LanguageModelToolCallPart[] = [];

      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part);
          yield part.value;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push(part);
        }
      }

      if (toolCalls.length === 0) return; // Done

      messages.push(vscode.LanguageModelChatMessage.Assistant([...textParts, ...toolCalls]));

      for (const call of toolCalls) {
        const args = call.input as Record<string, unknown>;
        const result = await executeTool(
          call.name as ToolName,
          args,
          { graph: this.graph!, config: this.config }
        );
        messages.push(
          vscode.LanguageModelChatMessage.User([
            new vscode.LanguageModelToolResultPart(call.callId, [
              new vscode.LanguageModelTextPart(result),
            ]),
          ])
        );
      }
    }

    yield "\n\n*(Maximum reasoning iterations reached.)*";
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getGraph(): SemanticGraph | null { return this.graph; }
  getModel(): vscode.LanguageModelChat | null { return this.model; }
  invalidateCache(): void { this.cache.clear(); }
  updateGraph(graph: SemanticGraph): void { this.graph = graph; this.cache.clear(); }
}
