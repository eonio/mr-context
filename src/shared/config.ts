// src/shared/config.ts
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { MrcConfig } from "./types.js";

const DEFAULTS: Required<Omit<MrcConfig, "repositories" | "githubToken">> = {
  branch: "main",
  includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"],
  excludePatterns: [
    "**/node_modules/**", "**/dist/**", "**/build/**",
    "**/.git/**", "**/*.test.*", "**/*.spec.*"
  ],
  maxFileSizeBytes: 100_000,
  graphCachePath: ".mrc-graph.json",
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
  const candidates = [".mrcaconfig", ".mrcaconfig.json", "mrc.config.json"];
  for (const name of candidates) {
    const full = resolve(process.cwd(), name);
    if (existsSync(full)) return full;
  }
  return null;
}
