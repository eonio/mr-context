// src/graph/builder.ts
// Two-pass semantic graph construction
// Pass 1 (this file): syntactic — symbol extraction via the parse/ backends
//   (TypeScript compiler API for TS/JS, tree-sitter for Python/Go, regex fallback)
// Pass 2: semantic enrichment — see enrichment.ts

import type {
  ExtractedFile,
  SemanticNode,
  GraphEdge,
  SemanticGraph,
  RepositoryMetadata,
} from "../shared/types.js";
import { extractFacts } from "./parse/index.js";

// ---------------------------------------------------------------------------
// Pattern detection (regex over raw content — independent of symbol extraction)
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
// Single-node builder (used by the file watcher for incremental updates)
// ---------------------------------------------------------------------------

export async function buildNode(file: ExtractedFile): Promise<SemanticNode> {
  const { exports, imports } = await extractFacts(file.content, file.language, file.path);
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
// Cross-repo entry-node resolution
// ---------------------------------------------------------------------------

// Pick the node that best represents a package's public entry point so a
// cross-repo import links to one precise file instead of every shared name.
function pickEntryNode(repoNodes: SemanticNode[], main?: string): SemanticNode | undefined {
  if (repoNodes.length === 0) return undefined;

  if (main) {
    const wanted = main.replace(/^\.\//, "").replace(/\\/g, "/");
    const byMain =
      repoNodes.find((n) => n.filePath === wanted) ??
      repoNodes.find((n) => n.filePath.replace(/\.[^.]+$/, "") === wanted.replace(/\.[^.]+$/, ""));
    if (byMain) return byMain;
  }

  const indexNodes = repoNodes
    .filter((n) => /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n.filePath))
    .sort((a, b) => a.filePath.split("/").length - b.filePath.split("/").length);
  return indexNodes[0] ?? repoNodes[0];
}

// ---------------------------------------------------------------------------
// Edge construction (shared by full build and the watcher's incremental patch)
// ---------------------------------------------------------------------------

export function buildEdges(nodes: SemanticNode[], repositories: RepositoryMetadata[]): GraphEdge[] {
  const edgeMap = new Map<string, GraphEdge>();

  // Intra-repo import edges: resolve a relative import to a file in the same repo.
  for (const node of nodes) {
    for (const imp of node.imports) {
      if (!imp.startsWith(".") && !imp.startsWith("/")) continue;
      // A bare "./" or "." import targets the directory's index file.
      const rel = imp.replace(/^(\.\.?\/)+/, "").replace(/\/$/, "") || "index";
      const target = nodes.find(
        (n) =>
          n.repository === node.repository &&
          n.id !== node.id &&
          n.filePath.replace(/\.[^.]+$/, "").endsWith(rel)
      );
      if (target) {
        const key = `${node.id}->${target.id}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: node.id, target: target.id, type: "imports", weight: 1.0 });
        }
      }
    }
  }

  // Cross-repo edges by package: an import whose specifier equals another repo's
  // package.json name links to that repo's entry node. Precise, unlike matching
  // on shared export names (which collides on common identifiers like `create`).
  const entryByPackage = new Map<string, { repo: string; entryId: string }>();
  for (const meta of repositories) {
    if (!meta.packageName) continue;
    const repo = `${meta.owner}/${meta.name}`;
    const entry = pickEntryNode(nodes.filter((n) => n.repository === repo), meta.packageMain);
    if (entry) entryByPackage.set(meta.packageName, { repo, entryId: entry.id });
  }

  for (const node of nodes) {
    for (const imp of node.imports) {
      const pkg = entryByPackage.get(imp);
      if (pkg && pkg.repo !== node.repository) {
        const key = `${node.id}->${pkg.entryId}:cross`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: node.id, target: pkg.entryId, type: "imports", weight: 0.9 });
        }
      }
    }
  }

  return [...edgeMap.values()];
}

// ---------------------------------------------------------------------------
// Syntactic graph builder
// ---------------------------------------------------------------------------

export async function buildSyntacticGraph(
  files: ExtractedFile[],
  metadata: RepositoryMetadata[]
): Promise<SemanticGraph> {
  const nodes: SemanticNode[] = await Promise.all(
    files.map(async (file) => {
      const { exports, imports } = await extractFacts(file.content, file.language, file.path);
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
    })
  );

  return {
    nodes,
    edges: buildEdges(nodes, metadata),
    repositories: metadata,
    builtAt: new Date().toISOString(),
    version: "1.0.0",
  };
}
