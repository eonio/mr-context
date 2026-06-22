// src/vscode/lmTools.ts
// Registers Mr. Context capabilities as VS Code Language Model Tools so that
// Copilot agent mode can invoke them automatically — without an explicit @mrc
// mention. Each tool is a thin wrapper over the provider-agnostic core
// (executeTool / formatContextBlock), backed by the warm agent from the
// registry so the enriched graph and Copilot scorer are reused.

import * as vscode from "vscode";
import { getAgent, multiRepoBlock } from "../agent/registry.js";
import { executeTool } from "../agent/tools.js";
import type { ToolName } from "../agent/tools.js";
import { formatContextBlock } from "../graph/query.js";

function toResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

// High-level retrieve-and-summarize tool. One call returns a budgeted context
// block spanning all indexed repositories — the cheapest way for the agent to
// ground an answer, instead of orchestrating several low-level calls.
interface AskInput { query: string; topK?: number }

class AskTool implements vscode.LanguageModelTool<AskInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AskInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const gate = multiRepoBlock();
    if (gate) return toResult(gate);
    const agent = await getAgent(token);
    const nodes = await agent.getContext(options.input.query, options.input.topK);
    const budget = options.tokenizationOptions?.tokenBudget ?? 4000;
    const block = formatContextBlock(nodes, budget);
    return toResult(block);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<AskInput>
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Mr. Context: retrieving context for “${options.input.query}”` };
  }
}

// Generic wrapper for the granular core tools (graph-only, no LLM needed).
class CoreTool implements vscode.LanguageModelTool<Record<string, unknown>> {
  constructor(
    private readonly toolName: ToolName,
    private readonly message: string
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const gate = multiRepoBlock();
    if (gate) return toResult(gate);
    const agent = await getAgent(token);
    const graph = agent.getGraph();
    if (!graph) return toResult("Mr. Context: the semantic graph is not ready yet. Try again shortly.");
    const result = await executeTool(this.toolName, options.input, {
      graph,
      config: agent.getConfig(),
    });
    return toResult(result);
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: this.message };
  }
}

export function registerMrcTools(context: vscode.ExtensionContext): void {
  try {
    context.subscriptions.push(
      vscode.lm.registerTool("mr-context_ask", new AskTool()),
      vscode.lm.registerTool("mr-context_search", new CoreTool("search_codebase", "Mr. Context: searching the codebase…")),
      vscode.lm.registerTool("mr-context_dependencies", new CoreTool("get_dependencies", "Mr. Context: tracing dependencies…")),
      vscode.lm.registerTool("mr-context_pattern", new CoreTool("find_pattern", "Mr. Context: finding pattern usages…")),
      vscode.lm.registerTool("mr-context_file", new CoreTool("get_file", "Mr. Context: fetching file metadata…"))
    );
  } catch {
    // Language Model Tools API may be unavailable in older VS Code builds.
    console.warn("[mr-context] Language Model Tools API unavailable in this VS Code version.");
  }
}
