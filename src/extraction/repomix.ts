// src/extraction/repomix.ts
// Deterministic repomix enrichment (NO LLM). Runs repomix on each local clone to
// produce:
//   1. a token-efficient packed artifact per repo (.mrc/data/repomix/<name>.txt)
//      that agents can read whole via MCP, and
//   2. per-file compressed API signatures (--compress uses tree-sitter to keep
//      declarations and drop bodies) that enrich graph nodes.
//
// repomix is invoked via npx so it need not be a bundled dependency. If it is
// unavailable or fails, enrichment is skipped gracefully — the AST-built graph
// still stands on its own.

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import type { MrcConfig, SemanticGraph } from "../shared/types.js";
import { resolveRepos, REPOMIX_DIR } from "../shared/config.js";

const execFileAsync = promisify(execFile);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const REPOMIX_MAX_BUFFER = 256 * 1024 * 1024;

export interface RepomixOptions {
  localPath: string;          // clone working tree to pack
  outputPath: string;         // where to write the packed artifact
  includePatterns: string[];
  excludePatterns: string[];
  compress: boolean;          // --compress: tree-sitter signature extraction
}

export interface RepomixResult {
  outputPath: string;
  tokenCount: number;                 // total tokens reported by repomix (or estimated)
  signatures: Map<string, string>;    // relPath → compressed signature block
}

// Run repomix once over a local directory. Throws if the CLI cannot be run.
export async function runRepomix(opts: RepomixOptions): Promise<RepomixResult> {
  await mkdir(dirname(opts.outputPath), { recursive: true });

  const args = [
    "-y", "repomix",
    opts.localPath,
    "--output", opts.outputPath,
    "--style", "plain",
    "--no-security-check",
    "--top-files-len", "0",
  ];
  if (opts.compress) args.push("--compress");
  if (opts.includePatterns.length) args.push("--include", opts.includePatterns.join(","));
  if (opts.excludePatterns.length) args.push("--ignore", opts.excludePatterns.join(","));

  const { stdout, stderr } = await execFileAsync(npx, args, {
    maxBuffer: REPOMIX_MAX_BUFFER,
    shell: process.platform === "win32",
  });

  const raw = await readFile(opts.outputPath, "utf-8");
  return {
    outputPath: opts.outputPath,
    tokenCount: parseTokenCount(`${stdout}\n${stderr}`) ?? Math.ceil(raw.length / 4),
    signatures: parseSignatures(raw),
  };
}

// repomix plain style delimits files with a long "=" rule and a "File:" header.
function parseSignatures(raw: string): Map<string, string> {
  const sig = new Map<string, string>();
  const blocks = raw.split(/={3,}\r?\nFile:\s*(.+?)\r?\n={3,}/);
  for (let i = 1; i < blocks.length; i += 2) {
    const path = blocks[i].trim().replace(/\\/g, "/");
    const content = (blocks[i + 1] ?? "").trim();
    if (path) sig.set(path, content);
  }
  return sig;
}

// repomix prints a summary line like "Total Tokens: 12,345 tokens". The
// thousands separator is locale-dependent (comma or dot), so strip both.
function parseTokenCount(out: string): number | null {
  const m = out.match(/Total Tokens?:\s*([\d.,]+)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
  return isNaN(n) ? null : n;
}

// Condense a signature block into a single-line node digest. Keeps declaration
// lines (export/function/class/interface/type/def/func) and trims noise so the
// node summary stays token-cheap.
function digestSignature(block: string): string {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) =>
      /^(export|public|private|protected|async|function|class|interface|type|enum|const|let|var|def|func|fn|struct|impl|module\.exports|exports\.)\b/.test(l)
    );
  const uniq = [...new Set(lines)].slice(0, 12);
  return uniq.join(" · ");
}

export interface RepomixEnrichResult {
  reposPacked: number;
  nodesEnriched: number;
  totalTokens: number;
}

// Run repomix across every repo in the graph and merge results back in:
//   - meta.repomixPath / meta.tokenCount per repo
//   - node.signature for files repomix produced a signature for
// Best-effort: a repo whose repomix run fails is skipped with a warning.
export async function enrichWithRepomix(
  graph: SemanticGraph,
  config: MrcConfig
): Promise<RepomixEnrichResult> {
  const resolved = resolveRepos(config);
  const repomixDir = resolve(process.cwd(), REPOMIX_DIR);

  let reposPacked = 0;
  let nodesEnriched = 0;
  let totalTokens = 0;

  for (const meta of graph.repositories) {
    if (!meta.localPath) continue;
    const spec = resolved.find((r) => r.url === meta.url);
    const outputPath = join(repomixDir, `${spec?.name ?? meta.name}.txt`);

    try {
      const result = await runRepomix({
        localPath: meta.localPath,
        outputPath,
        includePatterns: spec?.includePatterns ?? config.includePatterns ?? [],
        excludePatterns: spec?.excludePatterns ?? config.excludePatterns ?? [],
        compress: true,
      });

      meta.repomixPath = outputPath;
      meta.tokenCount = result.tokenCount;
      totalTokens += result.tokenCount;
      reposPacked++;

      const repository = `${meta.owner}/${meta.name}`;
      for (const node of graph.nodes) {
        if (node.repository !== repository) continue;
        const block = result.signatures.get(node.filePath);
        if (block) {
          const digest = digestSignature(block);
          if (digest) {
            node.signature = digest;
            nodesEnriched++;
          }
        }
      }
    } catch (err) {
      console.warn(
        `[mr-context] repomix enrichment skipped for ${meta.owner}/${meta.name}: ${(err as Error).message}`
      );
    }
  }

  return { reposPacked, nodesEnriched, totalTokens };
}
