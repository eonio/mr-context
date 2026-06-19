// src/graph/enrichment.ts
// Semantic enrichment pass — provider injected by caller (VS Code LM API or test stub)
// This module has NO vscode import — it is usable in both CLI and extension contexts

import type { SemanticNode, ContentCache } from "../shared/types.js";

export type EnrichmentProvider = (prompt: string) => Promise<string>;

const BATCH_SIZE = 5;

function summarizePrompt(node: SemanticNode, content?: string): string {
  const header = `File: ${node.filePath} | Language: ${node.language} | Exports: ${node.exports.join(", ") || "none"} | Patterns: ${node.patterns.join(", ") || "none"}`;
  if (content) {
    const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n... (truncated)" : content;
    return `Summarize this source file in 2-3 sentences. Focus on its responsibility, key exports, notable design patterns, and any important internal logic.\n\n${header}\n\nSource:\n${truncated}\n\nRespond with only the summary — no preamble, no bullet points.`;
  }
  return `Summarize this source file in 2-3 sentences. Focus on its responsibility, key exports, and any notable design patterns.\n\n${header}\n\nRespond with only the summary — no preamble, no bullet points.`;
}

export async function enrichNodes(
  nodes: SemanticNode[],
  provider: EnrichmentProvider,
  onProgress?: (completed: number, total: number) => void,
  contentCache?: ContentCache
): Promise<SemanticNode[]> {
  const enriched: SemanticNode[] = [];
  let completed = 0;

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (node) => {
        const content = contentCache?.[node.id];
        if (!content && node.exports.length === 0 && node.patterns.length === 0) {
          return { ...node, summary: `${node.language} file at ${node.filePath}` };
        }
        const summary = await provider(summarizePrompt(node, content));
        return { ...node, summary: summary.trim() };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      enriched.push(r.status === "fulfilled" ? r.value : batch[j]);
      completed++;
      onProgress?.(completed, nodes.length);
    }
  }

  return enriched;
}
