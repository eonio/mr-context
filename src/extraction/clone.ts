// src/extraction/clone.ts
// Clone (or update) configured repositories into a local repos directory.
// All branch/protocol handling is delegated to git itself, so ssh://, ssl://,
// git://, SCP-like, and HTTPS URLs all work without special-casing.

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { parseRepositoryUrl } from "./github.js";

const execFileAsync = promisify(execFile);
const git = process.platform === "win32" ? "git.exe" : "git";
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// Filesystem-safe folder name for a repo, e.g. "owner__repo".
export function repoSlug(owner: string, name: string): string {
  return `${owner}__${name}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// Local clone path for a repo URL under the given repos directory.
export function repoLocalPath(reposDir: string, url: string): string {
  const { owner, name } = parseRepositoryUrl(url);
  return join(reposDir, repoSlug(owner, name));
}

// For GitHub HTTPS URLs, inject a token so private repos clone non-interactively.
// SSH/SSL schemes rely on the environment's SSH agent and are returned unchanged.
function authenticatedUrl(url: string, githubToken?: string): string {
  const token = githubToken ?? process.env.GITHUB_TOKEN;
  if (!token) return url;
  const m = url.match(/^https:\/\/github\.com\/(.+)$/);
  return m ? `https://${token}@github.com/${m[1]}` : url;
}

export interface CloneOptions {
  url: string;
  branch: string;
  reposDir: string;
  githubToken?: string;
}

// Clone the repo at the requested branch, or update an existing clone in place.
// Returns the absolute local path to the working tree.
export async function cloneOrUpdateRepo(opts: CloneOptions): Promise<string> {
  const dest = repoLocalPath(opts.reposDir, opts.url);
  const env = { ...process.env };

  if (existsSync(join(dest, ".git"))) {
    // Refresh existing clone: fetch the requested branch and hard-reset to it.
    await execFileAsync(git, ["-C", dest, "fetch", "--depth", "1", "origin", opts.branch], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    await execFileAsync(git, ["-C", dest, "checkout", "-B", opts.branch, `origin/${opts.branch}`], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    await execFileAsync(git, ["-C", dest, "reset", "--hard", `origin/${opts.branch}`], {
      maxBuffer: GIT_MAX_BUFFER, env,
    });
    return dest;
  }

  await mkdir(opts.reposDir, { recursive: true });
  await execFileAsync(git, [
    "clone",
    "--branch", opts.branch,
    "--single-branch",
    "--depth", "1",
    authenticatedUrl(opts.url, opts.githubToken),
    dest,
  ], { maxBuffer: GIT_MAX_BUFFER, env });

  return dest;
}
