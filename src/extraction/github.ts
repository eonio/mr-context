// src/extraction/github.ts
import { Octokit } from "@octokit/rest";
import type { MrcConfig, RepositoryMetadata } from "../shared/types.js";

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  branch: string;
  host: string;
  isGitHub: boolean;
}

export function parseRepositoryUrl(url: string): ParsedRepoUrl {
  // GitHub HTTPS: https://github.com/owner/repo[.git][/tree/branch]
  const githubHttps = url.match(
    /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?(?:[/?#].*)?$/
  );
  if (githubHttps) {
    return {
      owner: githubHttps[1],
      name: githubHttps[2],
      branch: githubHttps[3] ?? "main",
      host: "github.com",
      isGitHub: true,
    };
  }

  // SSH/SSL/GIT scheme: ssh://git@host:port/[owner/]repo.git
  //                     ssl://git@host:port/[owner/]repo.git
  const sshScheme = url.match(
    /^(?:ssh|ssl|git):\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?$/
  );
  if (sshScheme) {
    const parts = sshScheme[2].split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const owner = parts.length > 1 ? parts[parts.length - 2] : name;
    return { owner, name, branch: "main", host: sshScheme[1], isGitHub: false };
  }

  // SCP-like: git@host:path/repo.git
  const scpLike = url.match(/^(?:[^@]+@)?([^:]+):(.+?)(?:\.git)?$/);
  if (scpLike && !scpLike[1].includes("://")) {
    const parts = scpLike[2].split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const owner = parts.length > 1 ? parts[parts.length - 2] : name;
    return { owner, name, branch: "main", host: scpLike[1], isGitHub: false };
  }

  // Generic HTTPS: https://host/[...path/]owner/repo[.git]
  const httpsGeneric = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?(?:[/?#].*)?$/);
  if (httpsGeneric) {
    const isGitHub = httpsGeneric[1].includes("github.com");
    const parts = httpsGeneric[2].split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const owner = parts.length > 1 ? parts[parts.length - 2] : name;
    return { owner, name, branch: "main", host: httpsGeneric[1], isGitHub };
  }

  throw new Error(`Cannot parse repository URL: ${url}`);
}

export async function fetchRepositoryMetadata(
  url: string,
  config: MrcConfig,
  branch?: string
): Promise<RepositoryMetadata> {
  const parsed = parseRepositoryUrl(url);
  const resolvedBranch = branch ?? parsed.branch;

  if (!parsed.isGitHub) {
    return {
      url,
      owner: parsed.owner,
      name: parsed.name,
      branch: resolvedBranch,
      description: null,
      topics: [],
      language: null,
      starCount: 0,
      fileCount: 0,
      extractedAt: new Date().toISOString(),
    };
  }

  const octokit = new Octokit({ auth: config.githubToken ?? process.env.GITHUB_TOKEN });
  const repoData = await octokit.repos.get({ owner: parsed.owner, repo: parsed.name }).catch(() => null);
  const info = repoData?.data ?? null;

  return {
    url,
    owner: parsed.owner,
    name: parsed.name,
    branch: resolvedBranch ?? info?.default_branch ?? "main",
    description: info?.description ?? null,
    topics: info?.topics ?? [],
    language: info?.language ?? null,
    starCount: info?.stargazers_count ?? 0,
    fileCount: 0,
    extractedAt: new Date().toISOString(),
  };
}
