// src/extraction/local.ts
// Extract files from a local clone via glob + readFile.
// Replaces the previous repomix-based remote extraction.

import { glob } from "glob";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import type { ExtractedFile, RepositoryMetadata } from "../shared/types.js";
import { repoSlug } from "./clone.js";

// Absolute base dir of a repo's files on disk. Prefers the metadata localPath
// recorded at build time (handles both in-place local repos and clones); falls
// back to the conventional clone slug under reposDir.
export function repoBasePath(
  repositories: RepositoryMetadata[],
  repository: string,
  reposDir: string
): string {
  const meta = repositories.find((r) => `${r.owner}/${r.name}` === repository);
  if (meta?.localPath) return meta.localPath;
  const [owner, name] = repository.split("/");
  return join(reposDir, repoSlug(owner, name ?? owner));
}

// Read a node's source from disk, or null if unavailable.
export async function readNodeSource(
  repositories: RepositoryMetadata[],
  repository: string,
  filePath: string,
  reposDir: string
): Promise<string | null> {
  try {
    return await readFile(join(repoBasePath(repositories, repository, reposDir), filePath), "utf-8");
  } catch {
    return null;
  }
}

export interface LocalExtractOptions {
  localPath: string;       // absolute path to the clone working tree
  repository: string;      // "owner/name"
  branch: string;
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSizeBytes: number;
}

export async function extractLocalFiles(opts: LocalExtractOptions): Promise<ExtractedFile[]> {
  const patterns = opts.includePatterns.length > 0 ? opts.includePatterns : ["**/*"];
  const matches = await glob(patterns, {
    cwd: opts.localPath,
    ignore: opts.excludePatterns,
    nodir: true,
    dot: false,
    follow: false,
  });

  const files: ExtractedFile[] = [];
  for (const rel of matches) {
    const abs = join(opts.localPath, rel);
    try {
      const info = await stat(abs);
      if (info.size > opts.maxFileSizeBytes) continue;
      const content = await readFile(abs, "utf-8");
      files.push({
        path: rel.replace(/\\/g, "/"),
        content,
        language: detectLanguage(rel),
        repository: opts.repository,
        branch: opts.branch,
        size: info.size,
      });
    } catch {
      // File vanished or is unreadable (binary/permission) — skip.
    }
  }

  return files;
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", java: "java", cs: "csharp",
    rb: "ruby", php: "php", swift: "swift", kt: "kotlin",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    css: "css", scss: "scss", html: "html", sh: "bash",
  };
  return map[ext] ?? "plaintext";
}
