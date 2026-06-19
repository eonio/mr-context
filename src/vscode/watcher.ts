// src/vscode/watcher.ts
// Watches local workspace files and patches the semantic graph incrementally.
// Only files belonging to repos already in the Mr. Context config are tracked.

import * as vscode from "vscode";
import { readFileSync, existsSync } from "fs";
import { join, relative, resolve } from "path";
import type { MrcConfig, SemanticGraph, ExtractedFile, GraphEdge } from "../shared/types.js";
import { buildNode } from "../graph/builder.js";
import { saveGraph } from "../graph/index.js";
import { GRAPH_PATH, REPOS_DIR } from "../shared/config.js";
import { parseRepositoryUrl } from "../extraction/github.js";
import { repoSlug, readOriginUrl, sameRepo } from "../extraction/clone.js";
import type { MrcAgent } from "../agent/agent.js";

const DEBOUNCE_MS = 2000;

const WATCHED_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "go"]);
const EXCLUDE_RE = /[/\\](node_modules|dist|build|\.git)[/\\]/;

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

export class FileWatcher {
  private disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanged = new Set<string>();
  private pendingDeleted = new Set<string>();

  // Maps absolute clone folder path → repository "owner/name" (matches node IDs)
  private readonly folderRepoMap = new Map<string, string>();

  constructor(
    private readonly config: MrcConfig,
    private readonly agent: MrcAgent,
  ) {
    this.buildFolderRepoMap();
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  start(): vscode.Disposable {
    if (this.folderRepoMap.size === 0) {
      return { dispose: () => {} };
    }

    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, false, false);

    this.disposables.push(
      watcher.onDidChange((uri) => this.queue(uri, "change")),
      watcher.onDidCreate((uri) => this.queue(uri, "change")),
      watcher.onDidDelete((uri) => this.queue(uri, "delete")),
      watcher,
    );

    return { dispose: () => this.dispose() };
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private queue(uri: vscode.Uri, kind: "change" | "delete"): void {
    const fsPath = uri.fsPath;
    if (!this.isTracked(fsPath)) return;

    if (kind === "delete") {
      this.pendingDeleted.add(fsPath);
      this.pendingChanged.delete(fsPath);
    } else {
      this.pendingChanged.add(fsPath);
      this.pendingDeleted.delete(fsPath);
    }

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const changed = [...this.pendingChanged];
    const deleted = [...this.pendingDeleted];
    this.pendingChanged.clear();
    this.pendingDeleted.clear();

    if (changed.length === 0 && deleted.length === 0) return;

    const graph = this.agent.getGraph();
    if (!graph) return;

    await this.patchGraph(graph, changed, deleted);
  }

  // ---------------------------------------------------------------------------
  // Incremental graph patch
  // ---------------------------------------------------------------------------

  private async patchGraph(
    graph: SemanticGraph,
    changed: string[],
    deleted: string[],
  ): Promise<void> {
    const changedIds = new Set(
      [...changed, ...deleted].map((p) => this.filePathToNodeId(p)).filter(Boolean) as string[]
    );

    // Remove stale nodes
    graph.nodes = graph.nodes.filter((n) => !changedIds.has(n.id));

    // Add updated nodes for changed (not deleted) files
    for (const fsPath of changed) {
      const entry = this.resolveFileEntry(fsPath);
      if (!entry) continue;
      try {
        const content = readFileSync(fsPath, "utf-8");
        const file: ExtractedFile = {
          path: entry.relPath,
          content,
          language: this.detectLanguage(fsPath),
          repository: entry.repoUrl,
          branch: graph.repositories.find((r) => `${r.owner}/${r.name}` === entry.repoUrl)?.branch ?? "main",
          size: content.length,
        };
        graph.nodes.push(buildNode(file));
      } catch {
        // File deleted between event and read — skip
      }
    }

    // Rebuild all edges (fast in-memory op, avoids partial edge state)
    graph.edges = rebuildEdges(graph.nodes);
    graph.builtAt = new Date().toISOString();

    const cachePath = this.config.graphCachePath ?? GRAPH_PATH;
    saveGraph(graph, cachePath);
    this.agent.updateGraph(graph);
    this.agent.invalidateCache();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildFolderRepoMap(): void {
    const reposDir = resolve(process.cwd(), this.config.reposDir ?? REPOS_DIR);
    const folderOrigins = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      path: f.uri.fsPath,
      origin: readOriginUrl(f.uri.fsPath),
    }));

    for (const entry of this.config.repositories) {
      const url = typeof entry === "string" ? entry : entry.url;
      try {
        const { owner, name } = parseRepositoryUrl(url);
        const repository = `${owner}/${name}`;

        // A workspace folder that IS this repo is indexed in place (not cloned).
        const local = folderOrigins.find((f) => f.origin && sameRepo(f.origin, url));
        if (local) {
          this.folderRepoMap.set(local.path, repository);
          continue;
        }

        // Otherwise the repo lives in a clone under reposDir.
        const clonePath = join(reposDir, repoSlug(owner, name));
        if (existsSync(clonePath)) {
          this.folderRepoMap.set(clonePath, repository);
        }
      } catch {
        // Unparseable URL — skip; build would have failed for it anyway.
      }
    }
  }

  private isTracked(fsPath: string): boolean {
    const ext = fsPath.split(".").pop()?.toLowerCase() ?? "";
    if (!WATCHED_EXTENSIONS.has(ext)) return false;
    if (EXCLUDE_RE.test(fsPath)) return false;
    return this.findFolder(fsPath) !== null;
  }

  private findFolder(fsPath: string): { folderPath: string; repoUrl: string } | null {
    // Longest-prefix match: a clone nested inside the local repo's working tree
    // (e.g. <root>/repos/B/...) must resolve to B, not the enclosing root repo.
    let best: { folderPath: string; repoUrl: string } | null = null;
    for (const [folderPath, repoUrl] of this.folderRepoMap) {
      if (fsPath.startsWith(folderPath) && (!best || folderPath.length > best.folderPath.length)) {
        best = { folderPath, repoUrl };
      }
    }
    return best;
  }

  private resolveFileEntry(fsPath: string): { relPath: string; repoUrl: string } | null {
    const entry = this.findFolder(fsPath);
    if (!entry) return null;
    const relPath = relative(entry.folderPath, fsPath).replace(/\\/g, "/");
    return { relPath, repoUrl: entry.repoUrl };
  }

  private filePathToNodeId(fsPath: string): string | null {
    const entry = this.resolveFileEntry(fsPath);
    if (!entry) return null;
    const slug = entry.repoUrl
      .replace(/https?:\/\/github\.com\//, "")
      .replace(/\//g, "__");
    return `${slug}::${entry.relPath}`;
  }

  private detectLanguage(fsPath: string): string {
    const ext = fsPath.split(".").pop()?.toLowerCase() ?? "";
    if (["ts", "tsx"].includes(ext)) return "typescript";
    if (["js", "jsx"].includes(ext)) return "javascript";
    if (ext === "py") return "python";
    if (ext === "go") return "go";
    return ext;
  }
}

// ---------------------------------------------------------------------------
// Edge rebuilder — same logic as buildSyntacticGraph, extracted for reuse
// ---------------------------------------------------------------------------

function rebuildEdges(nodes: SemanticGraph["nodes"]): GraphEdge[] {
  const edgeMap = new Map<string, GraphEdge>();

  // Intra-repo import edges
  for (const node of nodes) {
    for (const imp of node.imports) {
      if (!imp.startsWith(".") && !imp.startsWith("/")) continue;
      const target = nodes.find(
        (n) =>
          n.repository === node.repository &&
          n.filePath.replace(/\.[^.]+$/, "").endsWith(
            imp.replace(/^\.\//, "").replace(/^\.\.\//, "")
          )
      );
      if (target) {
        const key = `${node.id}->${target.id}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: node.id, target: target.id, type: "imports", weight: 1.0 });
        }
      }
    }
  }

  // Cross-repo edges via shared export names
  const exportIndex = new Map<string, SemanticGraph["nodes"][number][]>();
  for (const node of nodes) {
    for (const exp of node.exports) {
      const arr = exportIndex.get(exp) ?? [];
      arr.push(node);
      exportIndex.set(exp, arr);
    }
  }

  for (const node of nodes) {
    for (const imp of node.imports) {
      for (const exporter of exportIndex.get(imp) ?? []) {
        if (exporter.repository !== node.repository) {
          const key = `${node.id}->${exporter.id}:cross`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, {
              source: node.id,
              target: exporter.id,
              type: "shares-type",
              weight: 0.7,
            });
          }
        }
      }
    }
  }

  return [...edgeMap.values()];
}
