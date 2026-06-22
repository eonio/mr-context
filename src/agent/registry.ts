// src/agent/registry.ts
// Singleton factory for MrcAgent — used by the VS Code extension
// to share one agent instance across commands and chat participants.
//
// This file has a vscode import for the CancellationToken type only —
// the actual vscode.lm calls live in agent.ts.

import * as vscode from "vscode";
import { join, isAbsolute } from "path";
import { MrcAgent } from "./agent.js";
import { loadConfig, multiRepoIssue, CONFIG_PATH, REPOS_DIR } from "../shared/config.js";

// Resolve the .mrc/config.json path from the `mr-context.configPath` setting,
// falling back to the first workspace folder root. Without this the config
// loader would use the extension host's process.cwd(), which is not the
// user's project.
function resolveConfigPath(): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const setting = vscode.workspace
    .getConfiguration("mr-context")
    .get<string>("configPath")
    ?.trim();

  if (setting) {
    return isAbsolute(setting) || !root ? setting : join(root, setting);
  }
  return root ? join(root, CONFIG_PATH) : undefined;
}

// Multi-repo gate for the extension. Returns the clear, user-facing message when
// the workspace has fewer than the required repos, or null when OK. Cheap: loads
// only the config, never the graph — so callers can short-circuit before any work.
export function multiRepoBlock(): string | null {
  try {
    return multiRepoIssue(loadConfig(resolveConfigPath()));
  } catch {
    return null;
  }
}

let instance: MrcAgent | null = null;
let pending: Promise<MrcAgent> | null = null;

export async function getAgent(token: vscode.CancellationToken): Promise<MrcAgent> {
  if (instance) return instance;
  if (!pending) {
    pending = (async () => {
      const config = loadConfig(resolveConfigPath());
      // Refuse to build a graph for a single repo / monorepo.
      const issue = multiRepoIssue(config);
      if (issue) throw new Error(issue);
      // Anchor the graph cache to the workspace root so the extension and the
      // `mrc` CLI (run from the project root) share the same .mrc/data/graph.json.
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root && config.graphCachePath && !isAbsolute(config.graphCachePath)) {
        config.graphCachePath = join(root, config.graphCachePath);
      }
      // Anchor the clones directory to the workspace root too, so enrichment,
      // read_file, and the watcher all resolve the same local clones the CLI made.
      if (root) {
        const reposDir = config.reposDir ?? REPOS_DIR;
        config.reposDir = isAbsolute(reposDir) ? reposDir : join(root, reposDir);
      }
      const agent = new MrcAgent(config);
      await agent.initialize(token);
      instance = agent;
      return agent;
    })();
  }
  return pending;
}

export function resetAgent(): void {
  instance = null;
  pending = null;
}
