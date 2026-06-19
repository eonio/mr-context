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

// A repository can be a bare URL string (uses the global `branch`) or an
// object that overrides the branch for that repo only.
export interface RepoSpec {
  url: string;
  branch?: string;
}

export type RepoEntry = string | RepoSpec;

// A repository spec with its branch already resolved.
export interface ResolvedRepo {
  url: string;
  branch: string;
}

export type ContentCache = Record<string, string>; // nodeId → file content

export interface MrcConfig {
  repositories: RepoEntry[];
  githubToken?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSizeBytes?: number;
  graphCachePath?: string;
  contentCachePath?: string;
  maxContextNodes?: number;
  embeddingModel?: string;
}
