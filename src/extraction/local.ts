// src/extraction/local.ts
// Extract files from a local clone via glob + readFile.
// Replaces the previous repomix-based remote extraction.

import { glob } from "glob";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import type { ExtractedFile } from "../shared/types.js";
import { repoSlug } from "./clone.js";

// Absolute path to a graph node's source file in the local clones directory.
// `repository` is "owner/name"; `filePath` is relative to the clone root.
export function nodeSourcePath(reposDir: string, repository: string, filePath: string): string {
  const [owner, name] = repository.split("/");
  return join(reposDir, repoSlug(owner, name ?? owner), filePath);
}

// Read a node's source from the local clone, or null if unavailable.
export async function readNodeSource(
  reposDir: string,
  repository: string,
  filePath: string
): Promise<string | null> {
  try {
    return await readFile(nodeSourcePath(reposDir, repository, filePath), "utf-8");
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
