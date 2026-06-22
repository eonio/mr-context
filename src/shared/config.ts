// src/shared/config.ts
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { MrcConfig, ResolvedRepo } from "./types.js";

// Mr. Context state lives under a single .mrc/ folder at the workspace root.
// Cloned repositories live as SIBLINGS of .mrc (directly in the workspace), so a
// workspace looks like:
//   workspace/.mrc/          config + graph + repomix artifacts
//   workspace/project-A/     clone
//   workspace/project-B/     clone
export const MRC_DIR = ".mrc";
export const CONFIG_PATH = `${MRC_DIR}/config.json`;
export const GRAPH_PATH = `${MRC_DIR}/data/graph.json`;
export const REPOMIX_DIR = `${MRC_DIR}/data/repomix`;

// Base directory for clones: the workspace root (where .mrc lives). Repos are
// cloned into <root>/<name>. Overridable via config.reposDir.
export const REPOS_DIR = ".";

const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**", "**/dist/**", "**/build/**",
  "**/.git/**", "**/*.test.*", "**/*.spec.*",
];

const DEFAULTS: Required<
  Omit<MrcConfig, "repositories" | "githubToken" | "reposDir">
> = {
  includePatterns: DEFAULT_INCLUDE,
  excludePatterns: DEFAULT_EXCLUDE,
  maxFileSizeBytes: 100_000,
  graphCachePath: GRAPH_PATH,
  maxContextNodes: 25,
  embeddingModel: "text-embedding-3-small",
  repomix: true,
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

// Mr. Context is a MULTI-repository tool by design (the M + R are
// Multi-Repository). It needs at least this many repos to build cross-repo
// context, and deliberately does nothing below it so it never spends tokens on a
// single repo / monorepo where it adds no value.
export const MIN_REPOS = 2;

export function repoCount(config: MrcConfig): number {
  return config.repositories?.length ?? 0;
}

// Single source of truth for the multi-repo rule. Returns a clear, user-facing
// message when fewer than MIN_REPOS repos are configured, or null when OK.
export function multiRepoIssue(config: MrcConfig): string | null {
  const n = repoCount(config);
  if (n >= MIN_REPOS) return null;
  return (
    `Mr. Context is a multi-repository tool — the “M” and “R” stand for Multi-Repository. ` +
    `It needs at least ${MIN_REPOS} repositories in ${CONFIG_PATH}, but found ${n}. ` +
    `Add a second repository (e.g. a frontend + its backend, or a service + its shared types) ` +
    `so it can build cross-repo context. It does nothing for a single repo or monorepo, by ` +
    `design, to avoid wasting tokens where it adds no value.`
  );
}

// Derive a clone folder name from a repo URL: the last path segment, minus a
// trailing .git. Works across https/ssh/scp URL forms without parsing the host.
export function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/i, "").replace(/[/]+$/, "");
  const seg = cleaned.split(/[/:]/).filter(Boolean).pop();
  return seg && seg.length > 0 ? seg : "repo";
}

// Normalize the repositories list into fully-resolved specs. A bare string entry
// inherits global defaults; an object entry overrides branch, folder name, and
// include/exclude patterns. Branch defaults to "main".
export function resolveRepos(config: MrcConfig): ResolvedRepo[] {
  const defInclude = config.includePatterns ?? DEFAULTS.includePatterns;
  const defExclude = config.excludePatterns ?? DEFAULTS.excludePatterns;

  return config.repositories.map((entry) => {
    if (typeof entry === "string") {
      return {
        url: entry,
        branch: "main",
        name: repoNameFromUrl(entry),
        includePatterns: defInclude,
        excludePatterns: defExclude,
      };
    }
    return {
      url: entry.url,
      branch: entry.branch ?? "main",
      name: entry.name ?? repoNameFromUrl(entry.url),
      includePatterns: entry.includePatterns ?? defInclude,
      excludePatterns: entry.excludePatterns ?? defExclude,
    };
  });
}
