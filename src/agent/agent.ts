// src/agent/agent.ts
// MrcAgent — coordinates VS Code LM API, semantic graph, skill routing, and tool loop.
// This file imports from 'vscode' and must only be used in extension context.

import * as vscode from "vscode";
import { resolve } from "path";
import type { SemanticGraph, MrcConfig } from "../shared/types.js";
import { GRAPH_PATH, REPOS_DIR } from "../shared/config.js";
import { loadOrBuildGraph, saveGraph, enrichNodes, embedNodes } from "../graph/index.js";
import type { EmbeddingProvider } from "../graph/index.js";
import { readNodeSource } from "../extraction/index.js";
import { queryGraph } from "../graph/query.js";
import { detectSkill, buildSkillPrompt } from "./skills.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import type { SkillName } from "./skills.js";
import type { ToolName } from "./tools.js";

interface CacheEntry { nodes: SemanticNode[]; timestamp: number; }
// Avoid circular import — re-declare type locally
type SemanticNode = import("../shared/types.js").SemanticNode;

export class MrcAgent {
  private model: vscode.LanguageModelChat | null = null;
  private embeddings: EmbeddingProvider | null = null;
  private graph: SemanticGraph | null = null;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly config: MrcConfig) {}

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(token: vscode.CancellationToken): Promise<void> {
    this.model = await this.selectModel();
    this.embeddings = await this.buildEmbeddingProvider(token);
    this.graph = await loadOrBuildGraph(this.config);

    const needEnrich = this.graph.nodes.some((n) => !n.summary);
    const needEmbed = !!this.embeddings && this.graph.nodes.some((n) => !n.embedding?.length);
    if ((needEnrich || needEmbed) && !token.isCancellationRequested) {
      // Fire background passes so initialize() resolves immediately. Tool calls
      // get the syntactic graph right away; summaries + embeddings fill in over time.
      this.runBackgroundPasses(token).catch(() => {});
    }
  }

  // Wrap vscode.lm's embedding models if the host exposes them. The embeddings
  // API is not in the stable typings yet, so feature-detect via a narrow cast;
  // when absent we return null and retrieval stays pure BM25 — never any other LLM.
  private async buildEmbeddingProvider(
    token: vscode.CancellationToken
  ): Promise<EmbeddingProvider | null> {
    const lm = vscode.lm as unknown as {
      selectEmbeddingModels?: (selector: { vendor?: string }) => Promise<Array<{
        computeEmbeddings: (
          texts: string[],
          token?: vscode.CancellationToken
        ) => Promise<Array<{ values: number[] }>>;
      }>>;
    };
    if (typeof lm.selectEmbeddingModels !== "function") return null;
    try {
      const models = await lm.selectEmbeddingModels({ vendor: "copilot" });
      if (!models || models.length === 0) return null;
      const model = models[0];
      return async (texts: string[]) => {
        const res = await model.computeEmbeddings(texts, token);
        return res.map((r) => r.values);
      };
    } catch {
      return null;
    }
  }

  // Background: enrich summaries, then embed nodes for hybrid retrieval.
  private async runBackgroundPasses(token: vscode.CancellationToken): Promise<void> {
    if (this.graph?.nodes.some((n) => !n.summary)) {
      await this.runEnrichment(token);
    }
    if (this.embeddings && this.graph?.nodes.some((n) => !n.embedding?.length)) {
      if (token.isCancellationRequested) return;
      this.graph.nodes = await embedNodes(this.graph.nodes, this.embeddings);
      saveGraph(this.graph, this.config.graphCachePath ?? GRAPH_PATH);
      this.cache.clear(); // drop BM25-only results cached before embeddings landed
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

    const reposDir = resolve(process.cwd(), this.config.reposDir ?? REPOS_DIR);
    const repos = this.graph.repositories;
    const getContent = (node: SemanticNode) =>
      readNodeSource(repos, node.repository, node.filePath, reposDir).then((c) => c ?? undefined);
    this.graph.nodes = await enrichNodes(this.graph.nodes, provider, undefined, getContent);
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

    // Hybrid retrieval: BM25 candidates reranked by embedding similarity when
    // available (no per-node LLM scoring, so no chat-credit cost). Falls back to
    // pure BM25 when embeddings aren't ready or the host lacks the API.
    let queryEmbedding: number[] | undefined;
    if (this.embeddings) {
      try {
        queryEmbedding = (await this.embeddings([query]))[0];
      } catch {
        queryEmbedding = undefined;
      }
    }
    const nodes = await queryGraph(this.graph, query, k, undefined, queryEmbedding);
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

    // Code-generating skills need more tool rounds (search → read → write) than
    // a plain Q&A. A config value overrides the per-skill default.
    const codeGen = skill === "feature" || skill === "review";
    const maxIterations = this.config.maxAgentIterations ?? (codeGen ? 16 : 8);

    yield* this.toolLoop(messages, tools, token, maxIterations);
  }

  // ---------------------------------------------------------------------------
  // Tool loop
  // ---------------------------------------------------------------------------

  private async *toolLoop(
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelChatTool[],
    token: vscode.CancellationToken,
    maxIterations = 8
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

    // Out of tool rounds but the model still wanted to call tools — force one
    // final pass with NO tools so it must produce its best answer/code from the
    // context gathered so far. Never leave the user with an empty stop.
    yield* this.forceFinalAnswer(messages, token);
  }

  // Final completion with tools disabled: the model can only emit text, so it
  // delivers the result instead of looping further.
  private async *forceFinalAnswer(
    messages: vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken
  ): AsyncGenerator<string> {
    messages.push(
      vscode.LanguageModelChatMessage.User(
        "Tool-call budget reached. Do not request more tools. Produce your best, complete answer — including any code — using the context already gathered."
      )
    );
    try {
      const res = await this.model!.sendRequest(messages, {}, token); // no tools
      let any = false;
      for await (const part of res.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          any = true;
          yield part.value;
        }
      }
      if (any) {
        yield "\n\n*(Reached the tool-call limit — answered from the context gathered so far. Ask me to continue for more.)*";
        return;
      }
    } catch {
      /* fall through to the note */
    }
    yield "\n\n*(Reached the tool-call limit. Ask me to continue, or narrow the request.)*";
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getGraph(): SemanticGraph | null { return this.graph; }
  getModel(): vscode.LanguageModelChat | null { return this.model; }
  getConfig(): MrcConfig { return this.config; }
  invalidateCache(): void { this.cache.clear(); }
  updateGraph(graph: SemanticGraph): void { this.graph = graph; this.cache.clear(); }
}
