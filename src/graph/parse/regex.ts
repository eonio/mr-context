// src/graph/parse/regex.ts
// Regex fact extraction — the last-resort fallback when neither the TS compiler
// API nor tree-sitter is available for a file. Lossy by design.

import type { Facts } from "./facts.js";

function extractTsLike(content: string): Facts {
  const exports: string[] = [];
  const imports: string[] = [];

  const exportPattern =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportPattern.exec(content)) !== null) {
    if (!exports.includes(m[1])) exports.push(m[1]);
  }

  const reexportPattern = /export\s*\{([^}]+)\}/g;
  while ((m = reexportPattern.exec(content)) !== null) {
    m[1].split(",").forEach((name) => {
      const trimmed = name.trim().split(/\s+as\s+/).pop()?.trim();
      if (trimmed && /^\w+$/.test(trimmed) && !exports.includes(trimmed)) exports.push(trimmed);
    });
  }

  const importPattern = /from\s+["']([^"']+)["']/g;
  while ((m = importPattern.exec(content)) !== null) {
    const specifier = m[1];
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      const base = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!imports.includes(base)) imports.push(base);
    } else if (!imports.includes(specifier)) {
      imports.push(specifier);
    }
  }

  return { exports, imports };
}

function extractGeneric(content: string): Facts {
  const exports: string[] = [];
  const imports: string[] = [];

  const exportPattern = /export\s+(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportPattern.exec(content)) !== null) exports.push(m[1]);

  const importPattern = /(?:from|import)\s+["']([^"']+)["']/g;
  while ((m = importPattern.exec(content)) !== null) imports.push(m[1]);

  return { exports: [...new Set(exports)], imports: [...new Set(imports)] };
}

export function regexFacts(content: string, language: string): Facts {
  return ["typescript", "javascript"].includes(language)
    ? extractTsLike(content)
    : extractGeneric(content);
}
