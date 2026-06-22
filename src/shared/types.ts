// src/shared/types.ts
// Core data contracts for mr-context

export interface ExtractedFile {
  path: string;
  content: string;
  language: string;
  repository: string;
  branch: string;
  size: number;
}

export interface RepositoryMetadata {
  url: string;
  owner: string;
  name: string;
  branch: string;
  description: string | null;
  topics: string[];
  language: string | null;
  starCount: number;
  fileCount: number;
  extractedAt: string;
  local?: boolean;     // present on disk as a local clone (always true in the workspace model)
  localPath?: string;  // absolute base dir of this repo's files on disk
  dirty?: boolean;     // existing clone had uncommitted changes; left untouched (not reset to config branch)
  packageName?: string; // package.json "name" — used for cross-repo import edges
  packageMain?: string; // package.json main/module — used to pick the entry node
  repomixPath?: string; // path to the packed repomix artifact for this repo (agent-readable via MCP)
  tokenCount?: number;  // total token count reported by repomix for the packed repo
}

export interface SemanticNode {
  id: string;
  filePath: string;
  repository: string;
  language: string;
  exports: string[];
  imports: string[];
  patterns: string[];
  summary: string;
  signature?: string;  // deterministic API signature digest from repomix --compress (no LLM)
  embedding?: number[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "imports" | "exports-to" | "shares-type" | "pattern-sibling";
  weight: number;
}

export interface SemanticGraph {
  nodes: SemanticNode[];
  edges: GraphEdge[];
  repositories: RepositoryMetadata[];
  builtAt: string;
  version: string;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  metadata: RepositoryMetadata[];
}

// A repository can be a bare URL string (inherits global defaults) or an object
// that overrides branch, clone folder name, and include/exclude patterns per repo.
export interface RepoSpec {
  url: string;
  branch?: string;
  name?: string;             // clone folder name under the workspace (default: repo name from URL)
  includePatterns?: string[]; // overrides global includePatterns for this repo only
  excludePatterns?: string[]; // overrides global excludePatterns for this repo only
}

export type RepoEntry = string | RepoSpec;

// A repository spec with branch, folder name, and patterns fully resolved.
export interface ResolvedRepo {
  url: string;
  branch: string;
  name: string;
  includePatterns: string[];
  excludePatterns: string[];
}

export interface MrcConfig {
  repositories: RepoEntry[];
  githubToken?: string;
  reposDir?: string;          // base dir for clones (default: workspace root, siblings of .mrc)
  includePatterns?: string[]; // global default; per-repo includePatterns overrides this
  excludePatterns?: string[]; // global default; per-repo excludePatterns overrides this
  maxFileSizeBytes?: number;
  graphCachePath?: string;
  maxContextNodes?: number;
  embeddingModel?: string;
  repomix?: boolean;          // run repomix enrichment during build (default: true)
  maxAgentIterations?: number; // tool-call rounds per @mrc turn; overrides the skill default
}
