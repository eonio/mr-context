// src/extraction/index.ts
import type { ExtractionResult, MrcConfig, ResolvedRepo, RepositoryMetadata } from "../shared/types.js";
import { resolveRepos, REPOS_DIR, multiRepoIssue } from "../shared/config.js";
import { resolve, join } from "path";
import { readFileSync } from "fs";
import { cloneOrUpdateRepo, readCurrentBranch } from "./clone.js";
import { extractLocalFiles } from "./local.js";
import { parseRepositoryUrl, fetchRepositoryMetadata } from "./github.js";

export interface ExtractedRepo {
  files: ExtractionResult["files"];
  metadata: RepositoryMetadata;
}

// Clone (or update) every configured repo into the workspace as a sibling of
// .mrc, then extract its files. Returns flat files + per-repo metadata.
export async function extractRepositories(config: MrcConfig): Promise<ExtractionResult> {
  // Multi-repo is a hard requirement — refuse before cloning or building.
  const issue = multiRepoIssue(config);
  if (issue) throw new Error(issue);

  const repos = resolveRepos(config);

  const clonesDir = resolve(process.cwd(), config.reposDir ?? REPOS_DIR);

  const results = await Promise.allSettled(
    repos.map((repo) => extractSingle(repo, config, clonesDir))
  );

  const files: ExtractionResult["files"] = [];
  const metadata: RepositoryMetadata[] = [];

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
  clonesDir: string
): Promise<ExtractedRepo> {
  const { path: localPath, dirty } = await cloneOrUpdateRepo({
    url: repo.url,
    branch: repo.branch,
    name: repo.name,
    clonesDir,
    githubToken: config.githubToken,
  });

  const { owner, name } = parseRepositoryUrl(repo.url);
  const repository = `${owner}/${name}`;
  // A dirty clone is indexed at whatever branch is checked out, not the config one.
  const branch = dirty ? readCurrentBranch(localPath) ?? repo.branch : repo.branch;

  const [files, meta] = await Promise.all([
    extractLocalFiles({
      localPath,
      repository,
      branch,
      includePatterns: repo.includePatterns,
      excludePatterns: repo.excludePatterns,
      maxFileSizeBytes: config.maxFileSizeBytes ?? 100_000,
    }),
    fetchRepositoryMetadata(repo.url, config, branch),
  ]);

  meta.fileCount = files.length;
  meta.local = true;
  meta.localPath = localPath;
  meta.dirty = dirty;
  const pkg = readPackageJson(localPath);
  if (pkg) {
    meta.packageName = pkg.name;
    meta.packageMain = pkg.main;
  }
  return { files, metadata: meta };
}

function readPackageJson(localPath: string): { name?: string; main?: string } | null {
  try {
    const raw = readFileSync(join(localPath, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { name?: string; main?: string; module?: string };
    return { name: parsed.name, main: parsed.main ?? parsed.module };
  } catch {
    return null;
  }
}

export { cloneOrUpdateRepo, repoLocalPath, repoSlug, readOriginUrl, readCurrentBranch, sameRepo } from "./clone.js";
export { extractLocalFiles, readNodeSource, repoBasePath } from "./local.js";
export { fetchRepositoryMetadata } from "./github.js";
