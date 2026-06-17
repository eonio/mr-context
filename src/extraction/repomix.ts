// src/extraction/repomix.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ExtractedFile } from "../shared/types.js";
import { parseRepositoryUrl } from "./github.js";

const execFileAsync = promisify(execFile);

export interface RepomixOptions {
  url: string;
  branch: string;
  githubToken?: string;
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSizeBytes: number;
}

export async function extractWithRepomix(opts: RepomixOptions): Promise<ExtractedFile[]> {
  const { owner, name } = parseRepositoryUrl(opts.url);
  const repository = `${owner}/${name}`;

  const tempDir = await mkdtemp(join(tmpdir(), "mrc-"));
  const outputFile = join(tempDir, "repomix-output.txt");

  try {
    const args = [
      "repomix",
      "--remote", opts.url,
      "--remote-branch", opts.branch,
      "--output", outputFile,
      "--output-show-line-numbers",
      "--style", "plain",
    ];
    if (opts.includePatterns.length > 0) {
      args.push("--include", opts.includePatterns.join(","));
    }
    if (opts.excludePatterns.length > 0) {
      args.push("--ignore", opts.excludePatterns.join(","));
    }

    await execFileAsync("npx", args, {
      env: { ...process.env, GITHUB_TOKEN: opts.githubToken ?? process.env.GITHUB_TOKEN ?? "" },
      maxBuffer: 64 * 1024 * 1024,
    });

    const rawOutput = await readFile(outputFile, "utf-8");
    return parseRepomixOutput(rawOutput, repository, opts.branch);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseRepomixOutput(
  raw: string,
  repository: string,
  branch: string
): ExtractedFile[] {
  const fileBlocks = raw.split(/={3,}\nFile: (.+?)\n={3,}/);
  const files: ExtractedFile[] = [];

  for (let i = 1; i < fileBlocks.length; i += 2) {
    const path = fileBlocks[i].trim();
    const content = fileBlocks[i + 1]?.trim() ?? "";
    files.push({
      path,
      content,
      language: detectLanguage(path),
      repository,
      branch,
      size: Buffer.byteLength(content, "utf-8"),
    });
  }

  return files;
}

function detectLanguage(filePath: string): string {
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
