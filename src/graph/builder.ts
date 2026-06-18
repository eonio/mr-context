// src/graph/builder.ts
// Two-pass semantic graph construction
// Pass 1 (this file): syntactic — no LLM required
// Pass 2: semantic enrichment — see enrichment.ts

import type {
  ExtractedFile,
  SemanticNode,
  GraphEdge,
  SemanticGraph,
  RepositoryMetadata,
} from "../shared/types.js";

// ---------------------------------------------------------------------------
// TypeScript/JavaScript structural extraction (no compiler dependency)
// Uses regex-based approach for portability
// ---------------------------------------------------------------------------

function extractTSFacts(file: ExtractedFile): { exports: string[]; imports: string[] } {
  const exports: string[] = [];
  const imports: string[] = [];

  // Named exports: export function/class/const/interface/type/enum
  const exportPattern =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportPattern.exec(file.content)) !== null) {
    if (!exports.includes(m[1])) exports.push(m[1]);
  }

  // Re-exports: export { foo, bar }
  const reexportPattern = /export\s*\{([^}]+)\}/g;
  while ((m = reexportPattern.exec(file.content)) !== null) {
    m[1].split(",").forEach((name) => {
      const trimmed = name.trim().split(/\s+as\s+/).pop()?.trim();
      if (trimmed && /^\w+$/.test(trimmed) && !exports.includes(trimmed)) {
        exports.push(trimmed);
      }
    });
  }

  // Imports: import ... from '...'
  const importPattern = /from\s+["']([^"']+)["']/g;
  while ((m = importPattern.exec(file.content)) !== null) {
    const specifier = m[1];
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      // External package — record base package name
      const base = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!imports.includes(base)) imports.push(base);
    } else {
      if (!imports.includes(specifier)) imports.push(specifier);
    }
  }

  return { exports, imports };
}

function extractGenericFacts(
  file: ExtractedFile
): { exports: string[]; imports: string[] } {
  const exports: string[] = [];
  const imports: string[] = [];

  const exportPattern =
    /export\s+(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportPattern.exec(file.content)) !== null) exports.push(m[1]);

  const importPattern = /(?:from|import)\s+["']([^"']+)["']/g;
  while ((m = importPattern.exec(file.content)) !== null) imports.push(m[1]);

  return { exports, imports };
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

const PATTERN_SIGNATURES: Array<{ name: string; pattern: RegExp }> = [
  { name: "singleton",  pattern: /private\s+static\s+instance/i },
  { name: "factory",    pattern: /static\s+create\s*\(|createProcessor|createClient/i },
  { name: "repository", pattern: /findById|findAll|findOne\s*\(|\.save\s*\(/i },
  { name: "observer",   pattern: /addEventListener|\.on\s*\(|\.emit\s*\(/i },
  { name: "middleware", pattern: /\(req,\s*res,\s*next\)|NextFunction/i },
  { name: "strategy",   pattern: /interface\s+\w+Strategy|implements\s+\w+Strategy/i },
  { name: "decorator",  pattern: /@Injectable|@Controller|@Service|@Component/i },
  { name: "hook",       pattern: /^export\s+(?:default\s+)?function\s+use[A-Z]/m },
];

function detectPatterns(content: string): string[] {
  return PATTERN_SIGNATURES
    .filter(({ pattern }) => pattern.test(content))
    .map(({ name }) => name);
}

// ---------------------------------------------------------------------------
// Node ID
// ---------------------------------------------------------------------------

function nodeId(filePath: string, repository: string): string {
  const slug = repository
    .replace(/https?:\/\/github\.com\//, "")
    .replace(/\//g, "__");
  return `${slug}::${filePath}`;
}

// ---------------------------------------------------------------------------
// Single-node builder (used by file watcher for incremental updates)
// ---------------------------------------------------------------------------

export function buildNode(file: ExtractedFile): SemanticNode {
  const isTS = ["typescript", "javascript"].includes(file.language);
  const { exports, imports } = isTS
    ? extractTSFacts(file)
    : extractGenericFacts(file);

  return {
    id: nodeId(file.path, file.repository),
    filePath: file.path,
    repository: file.repository,
    language: file.language,
    exports: [...new Set(exports)],
    imports: [...new Set(imports)],
    patterns: detectPatterns(file.content),
    summary: "",
  };
}

// ---------------------------------------------------------------------------
// Syntactic graph builder
// ---------------------------------------------------------------------------

export function buildSyntacticGraph(
  files: ExtractedFile[],
  metadata: RepositoryMetadata[]
): SemanticGraph {
  const nodes: SemanticNode[] = [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const file of files) {
    const isTS = ["typescript", "javascript"].includes(file.language);
    const { exports, imports } = isTS
      ? extractTSFacts(file)
      : extractGenericFacts(file);

    nodes.push({
      id: nodeId(file.path, file.repository),
      filePath: file.path,
      repository: file.repository,
      language: file.language,
      exports: [...new Set(exports)],
      imports: [...new Set(imports)],
      patterns: detectPatterns(file.content),
      summary: "",
    });
  }

  // Intra-repo import edges
  for (const node of nodes) {
    for (const imp of node.imports) {
      if (!imp.startsWith(".") && !imp.startsWith("/")) continue;
      const target = nodes.find(
        (n) =>
          n.repository === node.repository &&
          n.filePath.replace(/\.[^.]+$/, "").endsWith(
            imp.replace(/^\.\//, "").replace(/^\.\.\//, "")
          )
      );
      if (target) {
        const key = `${node.id}->${target.id}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            source: node.id,
            target: target.id,
            type: "imports",
            weight: 1.0,
          });
        }
      }
    }
  }

  // Cross-repo edges via shared export names
  const exportIndex = new Map<string, SemanticNode[]>();
  for (const node of nodes) {
    for (const exp of node.exports) {
      const arr = exportIndex.get(exp) ?? [];
      arr.push(node);
      exportIndex.set(exp, arr);
    }
  }

  for (const node of nodes) {
    for (const imp of node.imports) {
      const exporters = exportIndex.get(imp) ?? [];
      for (const exporter of exporters) {
        if (exporter.repository !== node.repository) {
          const key = `${node.id}->${exporter.id}:cross`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, {
              source: node.id,
              target: exporter.id,
              type: "shares-type",
              weight: 0.7,
            });
          }
        }
      }
    }
  }

  return {
    nodes,
    edges: [...edgeMap.values()],
    repositories: metadata,
    builtAt: new Date().toISOString(),
    version: "1.0.0",
  };
}
