// src/extraction/index.ts
import type { ExtractionResult, MrcConfig, ResolvedRepo } from "../shared/types.js";
import { resolveRepos, REPOS_DIR, MRC_DIR } from "../shared/config.js";
import { resolve } from "path";
import { cloneOrUpdateRepo, readOriginUrl, readCurrentBranch, sameRepo } from "./clone.js";
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

  const reposDirName = config.reposDir ?? REPOS_DIR;
  const reposDir = resolve(process.cwd(), reposDirName);

  // If the current directory is itself one of the configured repos, index it
  // in place instead of cloning over the user's working tree.
  const cwd = process.cwd();
  const originUrl = readOriginUrl(cwd);

  const results = await Promise.allSettled(
    repos.map((repo) => extractSingle(repo, config, reposDir, reposDirName, cwd, originUrl))
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

async function extractSingle(
  repo: ResolvedRepo,
  config: MrcConfig,
  reposDir: string,
  reposDirName: string,
  cwd: string,
  originUrl: string | null,
) {
  const isLocal = originUrl !== null && sameRepo(originUrl, repo.url);

  // Local working repo: read files in place (no clone, no checkout/reset that
  // would clobber uncommitted work). Cloned repos go under reposDir.
  const localPath = isLocal
    ? cwd
    : await cloneOrUpdateRepo({
        url: repo.url,
        branch: repo.branch,
        reposDir,
        githubToken: config.githubToken,
      });

  // When indexing the working repo in place, the clones dir and .mrc live
  // underneath it — exclude them so B/C files aren't double-counted under A.
  const excludePatterns = [...(config.excludePatterns ?? [])];
  if (isLocal) {
    excludePatterns.push(`${reposDirName}/**`, `${MRC_DIR}/**`);
  }

  const { owner, name } = parseRepositoryUrl(repo.url);
  const repository = `${owner}/${name}`;
  const branch = isLocal ? readCurrentBranch(cwd) ?? repo.branch : repo.branch;

  const [files, meta] = await Promise.all([
    extractLocalFiles({
      localPath,
      repository,
      branch,
      includePatterns: config.includePatterns ?? [],
      excludePatterns,
      maxFileSizeBytes: config.maxFileSizeBytes ?? 100_000,
    }),
    fetchRepositoryMetadata(repo.url, config, branch),
  ]);

  meta.fileCount = files.length;
  meta.local = isLocal;
  meta.localPath = localPath;
  return { files, metadata: meta };
}

export { cloneOrUpdateRepo, repoLocalPath, repoSlug, readOriginUrl, readCurrentBranch, sameRepo } from "./clone.js";
export { extractLocalFiles, readNodeSource, repoBasePath } from "./local.js";
export { fetchRepositoryMetadata } from "./github.js";
