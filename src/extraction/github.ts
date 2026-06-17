// src/extraction/github.ts
import { Octokit } from "@octokit/rest";
import type { MrcConfig, RepositoryMetadata } from "../shared/types.js";

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  branch: string;
}

export function parseRepositoryUrl(url: string): ParsedRepoUrl {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/tree\/(.+))?$/);
  if (!match) throw new Error(`Cannot parse GitHub URL: ${url}`);
  return { owner: match[1], name: match[2], branch: match[3] ?? "main" };
}

export async function fetchRepositoryMetadata(
  url: string,
  config: MrcConfig
): Promise<RepositoryMetadata> {
  const { owner, name, branch } = parseRepositoryUrl(url);
  const octokit = new Octokit({ auth: config.githubToken ?? process.env.GITHUB_TOKEN });

  const repoData = await octokit.repos.get({ owner, repo: name }).catch(() => null);
  const info = repoData?.data ?? null;

  return {
    url,
    owner,
    name,
    branch: info?.default_branch ?? branch,
    description: info?.description ?? null,
    topics: info?.topics ?? [],
    language: info?.language ?? null,
    starCount: info?.stargazers_count ?? 0,
    fileCount: 0,
    extractedAt: new Date().toISOString(),
  };
}
