// src/graph/parse/index.ts
// Backend-agnostic fact extraction. Routing:
//   ts/tsx/js/jsx  → TypeScript compiler API (accurate, always available)
//   python/go/…    → tree-sitter (WASM), falling back to regex if unavailable
//   anything else  → regex
//
// Async because tree-sitter loads WASM grammars lazily.

import type { Facts } from "./facts.js";
import { extractTsFacts } from "./typescript.js";
import { extractTreeSitterFacts } from "./treesitter.js";
import { regexFacts } from "./regex.js";

export type { Facts } from "./facts.js";

const TS_LANGS = new Set(["typescript", "javascript"]);

export async function extractFacts(
  content: string,
  language: string,
  filePath: string
): Promise<Facts> {
  if (TS_LANGS.has(language)) {
    try {
      return extractTsFacts(content, filePath);
    } catch {
      return regexFacts(content, language);
    }
  }

  const ts = await extractTreeSitterFacts(content, language);
  return ts ?? regexFacts(content, language);
}
