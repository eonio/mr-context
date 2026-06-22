#!/usr/bin/env node
// src/mcp/server.ts
// Standalone Model Context Protocol (stdio) server exposing the Mr. Context
// semantic graph to any MCP client — Claude, Cursor, VS Code, or a custom
// agent. Read-only: it queries a graph already built by `mrc build`. Ranking
// uses BM25, so no LLM/API key is required.
//
// Launch (after `npm run build`):  mrc-mcp
// Config + graph are resolved from the current working directory's .mrc/
// folder, or via MRC_CONFIG / MRC_GRAPH environment overrides.

import { statSync, readFileSync } from "fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, resolveRepos, multiRepoIssue, GRAPH_PATH } from "../shared/config.js";
import { loadGraph } from "../graph/index.js";
import { queryGraph, formatContextBlock } from "../graph/query.js";
import { executeTool } from "../agent/tools.js";
import type { ToolName } from "../agent/tools.js";
import type { MrcConfig, SemanticGraph } from "../shared/types.js";

function graphPath(config: MrcConfig): string {
  return process.env.MRC_GRAPH ?? config.graphCachePath ?? GRAPH_PATH;
}

// Lazily load the graph and reload it if the cache file changed on disk, so a
// long-running server picks up a fresh `mrc build` without a restart.
let cached: { graph: SemanticGraph; config: MrcConfig; mtimeMs: number } | null = null;

function getState(): { graph: SemanticGraph; config: MrcConfig } {
  const config = loadConfig(process.env.MRC_CONFIG);

  // Multi-repo gate — refuse to serve a single-repo / monorepo config.
  const issue = multiRepoIssue(config);
  if (issue) throw new Error(issue);

  const path = graphPath(config);

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    throw new Error(
      `No graph found at "${path}". Run \`mrc build\` in the project first (needs a .mrc/config.json with repositories).`
    );
  }

  if (!cached || cached.mtimeMs !== mtimeMs) {
    const graph = loadGraph(path);
    if (!graph) throw new Error(`Failed to parse graph at "${path}".`);
    cached = { graph, config, mtimeMs };
  }
  return { graph: cached.graph, config: cached.config };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: "text" as const, text: `Mr. Context error: ${(err as Error).message}` }],
    isError: true,
  };
}

// Wrap a core tool call (graph-only) behind the MCP tool callback shape.
async function runCore(name: ToolName, args: Record<string, unknown>) {
  try {
    const { graph, config } = getState();
    const result = await executeTool(name, args, { graph, config });
    return textResult(result);
  } catch (err) {
    return errorResult(err);
  }
}

const server = new McpServer({ name: "mr-context", version: "1.0.0" });

const readOnly = { readOnlyHint: true, openWorldHint: false };

server.registerTool(
  "mrc_ask",
  {
    description:
      "Retrieve the most relevant multi-repository codebase context for a natural-language question. Returns a ranked, token-budgeted context block from the Mr. Context semantic graph spanning all indexed repositories. Prefer this before answering questions about how the codebase works or where functionality lives — cheaper than reading whole files.",
    inputSchema: {
      query: z.string().describe("The natural-language question or topic to retrieve context for."),
      topK: z.number().int().positive().optional().describe("Max graph nodes to include (default 25)."),
    },
    annotations: readOnly,
  },
  async ({ query, topK }) => {
    try {
      const { graph, config } = getState();
      const k = topK ?? config.maxContextNodes ?? 25;
      const nodes = await queryGraph(graph, query, k);
      return textResult(formatContextBlock(nodes));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "mrc_search",
  {
    description:
      "Search the Mr. Context semantic graph for files relevant to a query. Returns a ranked list with summaries to locate where functionality is implemented across the indexed repositories.",
    inputSchema: {
      query: z.string().describe("What you are looking for."),
      topK: z.number().int().positive().optional().describe("Max results (default 10)."),
    },
    annotations: readOnly,
  },
  ({ query, topK }) => runCore("search_codebase", { query, topK })
);

server.registerTool(
  "mrc_dependencies",
  {
    description:
      "Trace the import/dependency graph outward from a file for N hops using the Mr. Context semantic graph. Use to understand what a file depends on or how change impact propagates.",
    inputSchema: {
      filePath: z.string().describe("Starting file path as it appears in the graph."),
      hops: z.number().int().positive().max(4).optional().describe("Traversal depth (default 2, max 4)."),
    },
    annotations: readOnly,
  },
  ({ filePath, hops }) => runCore("get_dependencies", { filePath, hops })
);

server.registerTool(
  "mrc_pattern",
  {
    description:
      "Find all files implementing a specific design pattern (singleton, factory, repository, observer, middleware, strategy, decorator, hook) across the indexed repositories.",
    inputSchema: {
      pattern: z.string().describe("Pattern name, e.g. singleton | factory | repository | observer | middleware | strategy | decorator | hook"),
    },
    annotations: readOnly,
  },
  ({ pattern }) => runCore("find_pattern", { pattern })
);

server.registerTool(
  "mrc_read_file",
  {
    description:
      "Read the full source code of a specific file from the Mr. Context content cache or GitHub. Use after mrc_search or mrc_dependencies to inspect internal implementation details, follow imports recursively, or understand logic that summaries don't capture.",
    inputSchema: {
      filePath: z.string().describe("File path as it appears in the graph."),
      repository: z.string().optional().describe("Optional repository name or URL to disambiguate."),
    },
    annotations: readOnly,
  },
  ({ filePath, repository }) => runCore("read_file", { filePath, repository })
);

server.registerTool(
  "mrc_file",
  {
    description:
      "Retrieve a single file's metadata (summary, exports, imports, detected patterns) from the Mr. Context semantic graph by its path, without reading the full contents.",
    inputSchema: {
      filePath: z.string().describe("File path as it appears in the graph."),
      repository: z.string().optional().describe("Optional repository name filter."),
    },
    annotations: readOnly,
  },
  ({ filePath, repository }) => runCore("get_file", { filePath, repository })
);

server.registerResource(
  "repositories",
  "mrc://repositories",
  {
    title: "Indexed repositories",
    description: "The repositories currently configured / indexed in the Mr. Context graph.",
    mimeType: "application/json",
  },
  async (uri) => {
    let body: unknown;
    try {
      const { graph, config } = getState();
      body = {
        configured: resolveRepos(config),
        indexed: graph.repositories.map((r) => ({
          repository: `${r.owner}/${r.name}`,
          branch: r.branch,
          fileCount: r.fileCount,
          dirty: r.dirty ?? false,
          packedTokens: r.tokenCount ?? null,
          packedResource: r.repomixPath ? `mrc://repomix/${r.name}` : null,
        })),
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        builtAt: graph.builtAt,
      };
    } catch (err) {
      body = { error: (err as Error).message };
    }
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(body, null, 2) }] };
  }
);

// One token-efficient packed artifact per repo (repomix --compress signatures).
// Agents read a whole repo's public surface in a single resource fetch instead
// of many file reads — the core token-shield play, now cross-repo.
server.registerResource(
  "repomix-pack",
  new ResourceTemplate("mrc://repomix/{name}", {
    list: async () => {
      try {
        const { graph } = getState();
        return {
          resources: graph.repositories
            .filter((r) => r.repomixPath)
            .map((r) => ({
              uri: `mrc://repomix/${r.name}`,
              name: `${r.owner}/${r.name} (packed)`,
              description: `repomix --compress signatures for ${r.owner}/${r.name}` +
                (r.tokenCount ? ` (~${r.tokenCount.toLocaleString()} tokens)` : ""),
              mimeType: "text/plain",
            })),
        };
      } catch {
        return { resources: [] };
      }
    },
  }),
  {
    title: "Packed repository (repomix)",
    description: "Token-efficient compressed API signatures for an indexed repository, packed by repomix.",
    mimeType: "text/plain",
  },
  async (uri, { name }) => {
    const repoName = Array.isArray(name) ? name[0] : name;
    try {
      const { graph } = getState();
      const meta = graph.repositories.find((r) => r.name === repoName);
      if (!meta?.repomixPath) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `No packed artifact for "${repoName}". Run \`mrc build\` with repomix enabled.` }] };
      }
      const text = readFileSync(meta.repomixPath, "utf-8");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    } catch (err) {
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `Mr. Context error: ${(err as Error).message}` }] };
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive; never write to stdout (it is the
  // protocol channel). Diagnostics must go to stderr.
  console.error("[mr-context] MCP server ready on stdio.");
}

main().catch((err) => {
  console.error("[mr-context] MCP server failed to start:", err);
  process.exit(1);
});
