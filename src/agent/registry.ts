// src/agent/registry.ts
// Singleton factory for MrcAgent — used by the VS Code extension
// to share one agent instance across commands and chat participants.
//
// This file has a vscode import for the CancellationToken type only —
// the actual vscode.lm calls live in agent.ts.

import * as vscode from "vscode";
import { join, isAbsolute } from "path";
import { MrcAgent } from "./agent.js";
import { loadConfig, CONFIG_PATH } from "../shared/config.js";

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

let instance: MrcAgent | null = null;
let pending: Promise<MrcAgent> | null = null;

export async function getAgent(token: vscode.CancellationToken): Promise<MrcAgent> {
  if (instance) return instance;
  if (!pending) {
    pending = (async () => {
      const config = loadConfig(resolveConfigPath());
      // Anchor the graph cache to the workspace root so the extension and the
      // `mrc` CLI (run from the project root) share the same .mrc/data/graph.json.
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root && config.graphCachePath && !isAbsolute(config.graphCachePath)) {
        config.graphCachePath = join(root, config.graphCachePath);
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
