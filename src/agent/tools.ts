// src/agent/tools.ts
import type { SemanticGraph, SemanticNode, MrcConfig, ContentCache } from "../shared/types.js";
import { queryGraph } from "../graph/query.js";
import { loadContentCache } from "../graph/index.js";
import { Octokit } from "@octokit/rest";
import { parseRepositoryUrl } from "../extraction/github.js";

export const TOOL_DEFINITIONS = [
  {
    name: "search_codebase",
    description: "Search the semantic graph for files relevant to a query. Returns ranked results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "What you are looking for" },
        topK: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_file",
    description: "Retrieve a specific file's metadata by path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File path as it appears in the graph" },
        repository: { type: "string", description: "Optional repository name filter" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "find_pattern",
    description: "Find all files implementing a specific design pattern.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Pattern name: singleton | factory | repository | observer | middleware | strategy | decorator | hook",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "get_dependencies",
    description: "Trace the import graph for a file outward N hops.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Starting file path" },
        hops: { type: "number", description: "Traversal depth (default 2, max 4)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "read_file",
    description: "Read the full source code of a file from the content cache or GitHub. Use after search_codebase or get_dependencies to inspect implementation details, internal logic, or follow imports recursively.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File path as it appears in the graph" },
        repository: { type: "string", description: "Repository name or URL to disambiguate" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "add_repository",
    description: "Index a new GitHub repository into the semantic graph (triggers extraction).",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "Full GitHub repository URL" },
        branch: { type: "string", description: "Branch to index (default: main)" },
      },
      required: ["url"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export interface ToolContext {
  graph: SemanticGraph;
  config: MrcConfig;
  onAddRepository?: (url: string, branch: string) => Promise<SemanticGraph>;
  contentCache?: ContentCache;
}

function formatNode(node: SemanticNode): string {
  const repo = node.repository.split("/").slice(-1)[0];
  return [
    `File: ${node.filePath} [${repo}]`,
    node.summary ? `Summary: ${node.summary}` : null,
    node.exports.length > 0 ? `Exports: ${node.exports.join(", ")}` : null,
    node.imports.length > 0 ? `Imports: ${node.imports.slice(0, 5).join(", ")}` : null,
    node.patterns.length > 0 ? `Patterns: ${node.patterns.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const { graph } = context;

  switch (name) {
    case "search_codebase": {
      const nodes = await queryGraph(graph, args.query as string, Math.min((args.topK as number) ?? 10, 25));
      return nodes.length === 0 ? "No results." : nodes.map(formatNode).join("\n\n---\n\n");
    }

    case "get_file": {
      const node = graph.nodes.find(
        (n) =>
          n.filePath.includes(args.filePath as string) &&
          (!args.repository || n.repository.includes(args.repository as string))
      );
      return node ? formatNode(node) : `File not found: ${args.filePath}`;
    }

    case "find_pattern": {
      const pattern = (args.pattern as string).toLowerCase();
      const matching = graph.nodes.filter((n) => n.patterns.includes(pattern));
      if (matching.length === 0) return `No files found implementing ${pattern}.`;
      const byRepo = new Map<string, SemanticNode[]>();
      matching.forEach((n) => {
        const k = n.repository.split("/").slice(-1)[0];
        byRepo.set(k, [...(byRepo.get(k) ?? []), n]);
      });
      const lines = [`Found ${matching.length} file(s) implementing ${pattern}:`];
      for (const [repo, nodes] of byRepo) {
        lines.push(`\nRepository: ${repo}`);
        nodes.forEach((n) => lines.push(`  - ${n.filePath}`));
      }
      return lines.join("\n");
    }

    case "get_dependencies": {
      const root = graph.nodes.find((n) => n.filePath.includes(args.filePath as string));
      if (!root) return `File not found: ${args.filePath}`;
      const hops = Math.min((args.hops as number) ?? 2, 4);
      const edgeIndex = new Map<string, string[]>();
      graph.edges.forEach((e) => edgeIndex.set(e.source, [...(edgeIndex.get(e.source) ?? []), e.target]));
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const visited = new Set([root.id]);
      const levels: SemanticNode[][] = [[root]];
      for (let h = 0; h < hops; h++) {
        const next: SemanticNode[] = [];
        for (const n of levels[h]) {
          for (const tid of edgeIndex.get(n.id) ?? []) {
            if (!visited.has(tid)) {
              const t = nodeById.get(tid);
              if (t) { next.push(t); visited.add(tid); }
            }
          }
        }
        if (!next.length) break;
        levels.push(next);
      }
      const lines = [`Dependency tree for ${args.filePath}:`];
      levels.forEach((level, i) => {
        if (i === 0) return;
        lines.push(`\nHop ${i}:`);
        level.forEach((n) => lines.push(`  ${n.filePath} [${n.repository.split("/").slice(-1)[0]}]`));
      });
      return lines.join("\n");
    }

    case "read_file": {
      const node = graph.nodes.find(
        (n) =>
          n.filePath.includes(args.filePath as string) &&
          (!args.repository || n.repository.includes(args.repository as string))
      );
      if (!node) return `File not found in graph: ${args.filePath}`;

      // Try content cache first (populated during mrc build)
      const cache = context.contentCache ?? loadContentCache(context.config.contentCachePath);
      const cached = cache[node.id];
      if (cached) return `// ${node.filePath} [${node.repository}]\n\n${cached}`;

      // Fallback: fetch from GitHub
      const repoMeta = graph.repositories.find((r) => r.owner + "/" + r.name === node.repository || r.url === node.repository);
      if (!repoMeta) return `Cannot locate repository metadata for ${node.repository}. Run \`mrc build\` to refresh.`;
      try {
        const octokit = new Octokit({ auth: context.config.githubToken ?? process.env.GITHUB_TOKEN });
        const response = await octokit.repos.getContent({
          owner: repoMeta.owner,
          repo: repoMeta.name,
          path: node.filePath,
          ref: repoMeta.branch,
        });
        const data = response.data as { content?: string; encoding?: string };
        if (!data.content) return `No content returned for ${node.filePath}`;
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return `// ${node.filePath} [${node.repository}]\n\n${content}`;
      } catch (err) {
        return `Failed to fetch ${node.filePath} from GitHub: ${(err as Error).message}`;
      }
    }

    case "add_repository": {
      if (!context.onAddRepository) {
        return "add_repository is not available here. Use `mrc build` to rebuild the graph.";
      }
      const updated = await context.onAddRepository(args.url as string, (args.branch as string) ?? "main");
      return `Added. Graph now has ${updated.nodes.length} nodes across ${updated.repositories.length} repos.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
