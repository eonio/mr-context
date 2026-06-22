// src/agent/guardrails.ts
// Output guardrails for tool results. Every tool return passes through here so
// agents receive clean, minimal, structured, token-bounded text — never a raw
// file dump that blows the context budget. Token-efficiency is a hard rule:
// these caps are deliberate and apply to all callers (CLI agent + MCP).

// Rough budget: 1 token ≈ 4 chars. Caps below are chosen so a single tool
// result never dominates an agent's context window.
export const MAX_RESULT_CHARS = 6_000;   // any single tool result
export const MAX_FILE_CHARS = 8_000;     // read_file payload (≈2k tokens)
export const MAX_LIST_ITEMS = 25;        // search / pattern result rows

// Clamp text to a char budget, appending a single explicit truncation marker so
// the agent knows output was cut (and can narrow its query instead of asking for
// more). Never silently drops content.
export function clamp(text: string, maxChars = MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const cut = head.lastIndexOf("\n");
  const body = cut > maxChars * 0.6 ? head.slice(0, cut) : head;
  const omitted = text.length - body.length;
  return `${body}\n…[truncated ${omitted} chars — narrow your query or request a specific symbol]`;
}

// Clamp a file payload and prefix a stable, structured header so the agent can
// cite path + repo without re-deriving them.
export function clampFile(repository: string, filePath: string, content: string): string {
  const header = `// ${filePath} [${repository}]`;
  return `${header}\n\n${clamp(content, MAX_FILE_CHARS)}`;
}

// Cap a list of rendered rows and note how many were hidden, keeping result
// blocks short and scannable.
export function clampList(rows: string[], joiner = "\n\n---\n\n", max = MAX_LIST_ITEMS): string {
  if (rows.length === 0) return "No results.";
  const shown = rows.slice(0, max);
  const hidden = rows.length - shown.length;
  const body = shown.join(joiner);
  return hidden > 0 ? `${body}\n\n…[${hidden} more results hidden — refine your query]` : body;
}
