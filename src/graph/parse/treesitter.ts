// src/graph/parse/treesitter.ts
// Accurate exports/imports for non-JS languages (Python, Go, …) via
// web-tree-sitter (WASM grammars). Best-effort: if WASM init or a grammar fails
// to load (e.g. node_modules stripped in a packaged extension), every function
// returns null and the caller falls back to the regex extractor.

import { createRequire } from "module";
import type { Facts } from "./facts.js";

// Resolve dependency file paths. Created lazily inside init (not at module load)
// so that a CJS bundle where import.meta.url is unavailable — e.g. the esbuilt
// VS Code extension — degrades to the regex fallback instead of crashing on load.
let req: NodeRequire | null = null;

// Tree-sitter query per language: @export captures exported symbol names,
// @import captures module specifiers.
const QUERIES: Record<string, { wasm: string; query: string; goExportFilter?: boolean }> = {
  python: {
    wasm: "tree-sitter-python",
    query: `
      (module (function_definition name: (identifier) @export))
      (module (class_definition name: (identifier) @export))
      (module (decorated_definition definition: (function_definition name: (identifier) @export)))
      (module (decorated_definition definition: (class_definition name: (identifier) @export)))
      (import_statement name: (dotted_name) @import)
      (import_statement name: (aliased_import name: (dotted_name) @import))
      (import_from_statement module_name: (dotted_name) @import)
    `,
  },
  go: {
    wasm: "tree-sitter-go",
    goExportFilter: true,
    query: `
      (source_file (function_declaration name: (identifier) @export))
      (source_file (method_declaration name: (field_identifier) @export))
      (source_file (type_declaration (type_spec name: (type_identifier) @export)))
      (import_spec path: (interpreted_string_literal) @import)
    `,
  },
};

// Minimal structural types for the web-tree-sitter (0.20.x) API we use.
interface TSNode { text: string; }
interface TSQuery { captures(node: unknown): Array<{ name: string; node: TSNode }>; }
interface TSLanguage { query(source: string): TSQuery; }
interface TSParser { setLanguage(lang: TSLanguage): void; parse(input: string): { rootNode: unknown }; }
interface TSParserStatic {
  new (): TSParser;
  init(opts?: { locateFile?: (name: string) => string }): Promise<void>;
  Language: { load(path: string): Promise<TSLanguage> };
}

let initPromise: Promise<TSParserStatic | null> | null = null;
const langCache = new Map<string, TSLanguage | null>();

async function getParser(): Promise<TSParserStatic | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      req = createRequire(import.meta.url);
      const Parser = (await import("web-tree-sitter")).default as unknown as TSParserStatic;
      const coreWasm = req.resolve("web-tree-sitter/tree-sitter.wasm");
      await Parser.init({ locateFile: () => coreWasm });
      return Parser;
    } catch {
      return null;
    }
  })();
  return initPromise;
}

async function loadLanguage(Parser: TSParserStatic, wasm: string): Promise<TSLanguage | null> {
  if (langCache.has(wasm)) return langCache.get(wasm) ?? null;
  if (!req) return null;
  try {
    const wasmPath = req.resolve(`tree-sitter-wasms/out/${wasm}.wasm`);
    const lang = await Parser.Language.load(wasmPath);
    langCache.set(wasm, lang);
    return lang;
  } catch {
    langCache.set(wasm, null);
    return null;
  }
}

// Returns Facts, or null if tree-sitter is unavailable for this language.
export async function extractTreeSitterFacts(content: string, language: string): Promise<Facts | null> {
  const spec = QUERIES[language];
  if (!spec) return null;

  const Parser = await getParser();
  if (!Parser) return null;

  const lang = await loadLanguage(Parser, spec.wasm);
  if (!lang) return null;

  try {
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const query = lang.query(spec.query);
    const caps = query.captures(tree.rootNode);

    const exports = new Set<string>();
    const imports = new Set<string>();
    for (const cap of caps) {
      const text = cap.node.text;
      if (cap.name === "export") {
        // Go: only capitalized identifiers are exported.
        if (spec.goExportFilter && !/^[A-Z]/.test(text)) continue;
        exports.add(text);
      } else if (cap.name === "import") {
        imports.add(text.replace(/^["']|["']$/g, ""));
      }
    }
    return { exports: [...exports], imports: [...imports] };
  } catch {
    return null;
  }
}
