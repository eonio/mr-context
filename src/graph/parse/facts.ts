// src/graph/parse/facts.ts
// Shared shape for extracted syntactic facts. Kept dependency-free so every
// parser backend (TS compiler, tree-sitter, regex fallback) can import it.

export interface Facts {
  exports: string[];
  imports: string[];
}
