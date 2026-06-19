// src/extraction/index.ts
import type { ExtractionResult, MrcConfig, ResolvedRepo } from "../shared/types.js";
import { resolveRepos, REPOS_DIR } from "../shared/config.js";
import { resolve } from "path";
import { cloneOrUpdateRepo } from "./clone.js";
import { extractLocalFiles } from "./local.js";
import { parseRepositoryUrl, fetchRepositoryMetadata } from "./github.js";

export async function extractRepositories(
  config: MrcConfig
): Promise<ExtractionResult> {
  const repos = resolveRepos(config);
  if (repos.length === 0) {
    throw new Error(
      "No repositories configured. Add URLs to your .mrc/config.json file or set MRC_REPOS."
    );
  }

  const reposDir = resolve(process.cwd(), config.reposDir ?? REPOS_DIR);

  const results = await Promise.allSettled(
    repos.map((repo) => extractSingle(repo, config, reposDir))
  );

  const files = [];
  const metadata = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      files.push(...result.value.files);
      metadata.push(result.value.metadata);
    } else {
      console.warn(
        `[mr-context] Failed to extract ${repos[i].url}@${repos[i].branch}: ${result.reason}`
      );
    }
  }

  return { files, metadata };
}

async function extractSingle(repo: ResolvedRepo, config: MrcConfig, reposDir: string) {
  const localPath = await cloneOrUpdateRepo({
    url: repo.url,
    branch: repo.branch,
    reposDir,
    githubToken: config.githubToken,
  });

  const { owner, name } = parseRepositoryUrl(repo.url);
  const repository = `${owner}/${name}`;

  const [files, meta] = await Promise.all([
    extractLocalFiles({
      localPath,
      repository,
      branch: repo.branch,
      includePatterns: config.includePatterns ?? [],
      excludePatterns: config.excludePatterns ?? [],
      maxFileSizeBytes: config.maxFileSizeBytes ?? 100_000,
    }),
    fetchRepositoryMetadata(repo.url, config, repo.branch),
  ]);

  meta.fileCount = files.length;
  return { files, metadata: meta };
}

export { cloneOrUpdateRepo, repoLocalPath, repoSlug } from "./clone.js";
export { extractLocalFiles, readNodeSource, nodeSourcePath } from "./local.js";
export { fetchRepositoryMetadata } from "./github.js";
