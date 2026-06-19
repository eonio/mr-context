// src/graph/index.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { SemanticGraph, ContentCache, MrcConfig } from "../shared/types.js";
import { GRAPH_PATH, CONTENT_CACHE_PATH } from "../shared/config.js";
import { extractRepositories } from "../extraction/index.js";
import { buildSyntacticGraph } from "./builder.js";

export function saveGraph(graph: SemanticGraph, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(graph, null, 2), "utf-8");
}

export function loadGraph(path: string): SemanticGraph | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SemanticGraph;
  } catch {
    return null;
  }
}

export function saveContentCache(cache: ContentCache, path?: string): void {
  const target = path ?? CONTENT_CACHE_PATH;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(cache), "utf-8");
}

export function loadContentCache(path?: string): ContentCache {
  const target = path ?? CONTENT_CACHE_PATH;
  if (!existsSync(target)) return {};
  try {
    return JSON.parse(readFileSync(target, "utf-8")) as ContentCache;
  } catch {
    return {};
  }
}

/**
 * Load from cache or build a fresh syntactic graph.
 * Semantic enrichment is NOT applied here — the VS Code extension
 * applies it after this call via enrichNodes() from enrichment.ts.
 */
export async function loadOrBuildGraph(
  config: MrcConfig,
  forceRebuild = false
): Promise<SemanticGraph> {
  const cachePath = config.graphCachePath ?? GRAPH_PATH;

  if (!forceRebuild) {
    const cached = loadGraph(cachePath);
    if (cached) return cached;
  }

  const { files, metadata } = await extractRepositories(config);
  const graph = buildSyntacticGraph(files, metadata);
  saveGraph(graph, cachePath);
  return graph;
}

export { buildSyntacticGraph, buildNode } from "./builder.js";
export { enrichNodes } from "./enrichment.js";
export { queryGraph, formatContextBlock, buildScorer } from "./query.js";
