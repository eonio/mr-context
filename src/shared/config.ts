// src/shared/config.ts
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { MrcConfig } from "./types.js";

// All Mr. Context state lives under a single .mrc/ folder at the project root,
// so users can gitignore either the whole folder or just .mrc/data/.
export const MRC_DIR = ".mrc";
export const CONFIG_PATH = `${MRC_DIR}/config.json`;
export const GRAPH_PATH = `${MRC_DIR}/data/graph.json`;

const DEFAULTS: Required<Omit<MrcConfig, "repositories" | "githubToken">> = {
  branch: "main",
  includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"],
  excludePatterns: [
    "**/node_modules/**", "**/dist/**", "**/build/**",
    "**/.git/**", "**/*.test.*", "**/*.spec.*"
  ],
  maxFileSizeBytes: 100_000,
  graphCachePath: GRAPH_PATH,
  maxContextNodes: 25,
  embeddingModel: "text-embedding-3-small",
};

export function loadConfig(configPath?: string): MrcConfig {
  const path = configPath ?? findConfigFile();

  if (path && existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as Partial<MrcConfig>;
      // Remove _comment fields (JSON5-style) before merging
      const clean = Object.fromEntries(
        Object.entries(parsed).filter(([k]) => !k.startsWith("_"))
      ) as Partial<MrcConfig>;
      return { repositories: [], ...DEFAULTS, ...clean };
    } catch (err) {
      throw new Error(`Failed to parse config at ${path}: ${(err as Error).message}`);
    }
  }

  const reposEnv = process.env.MRC_REPOS;
  return {
    ...DEFAULTS,
    repositories: reposEnv ? reposEnv.split(",").map((r) => r.trim()) : [],
    githubToken: process.env.GITHUB_TOKEN,
  };
}

function findConfigFile(): string | null {
  const full = resolve(process.cwd(), CONFIG_PATH);
  return existsSync(full) ? full : null;
}
