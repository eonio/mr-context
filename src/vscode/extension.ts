// src/vscode/extension.ts
import * as vscode from "vscode";
import { getAgent, resetAgent } from "../agent/registry.js";
import { MrcPanel } from "./panel.js";
import { detectSkill } from "../agent/skills.js";
import type { SkillName } from "../agent/skills.js";
import { registerMrcTools } from "./lmTools.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cts = new vscode.CancellationTokenSource();
  context.subscriptions.push(cts);

  // Expose Mr. Context as Language Model Tools so Copilot agent mode can use
  // the semantic graph automatically, without an explicit @mrc mention.
  registerMrcTools(context);

  // Pre-warm agent in background so first @mrc invocation is instant
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Mr. Context: initializing…" },
    () =>
      getAgent(cts.token).catch((err: Error) => {
        vscode.window.showWarningMessage(`Mr. Context: ${err.message}`);
      })
  );

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("mr-context.openPanel", async () => {
      const agent = await getAgent(cts.token);
      MrcPanel.show(context.extensionUri, agent);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mr-context.buildGraph", () =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Mr. Context: rebuilding graph…",
          cancellable: true,
        },
        async (_progress, token) => {
          resetAgent();
          const agent = await getAgent(token);
          const graph = agent.getGraph();
          if (graph) {
            vscode.window.showInformationMessage(
              `Mr. Context: graph ready — ${graph.nodes.length} nodes`
            );
          }
        }
      )
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mr-context.querySelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selected = editor.document.getText(editor.selection);
      if (!selected.trim()) {
        vscode.window.showWarningMessage("Mr. Context: select some code first.");
        return;
      }
      const question = await vscode.window.showInputBox({
        prompt: "Ask Mr. Context about the selection",
        placeHolder: "What does this code do?",
      });
      if (!question) return;
      const agent = await getAgent(cts.token);
      MrcPanel.show(context.extensionUri, agent);
      // Panel will show; user can type in the prefilled context
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mr-context.showInfo", async () => {
      const agent = await getAgent(cts.token);
      const graph = agent.getGraph();
      if (!graph) {
        vscode.window.showInformationMessage("Mr. Context: no graph loaded yet.");
        return;
      }
      const enriched = graph.nodes.filter((n) => n.summary).length;
      vscode.window.showInformationMessage(
        `Mr. Context: ${graph.nodes.length} nodes (${enriched} enriched), ` +
          `${graph.edges.length} edges, ` +
          `${graph.repositories.length} repositories`
      );
    })
  );

  // ── Copilot chat participant ───────────────────────────────────────────────

  try {
    const participant = vscode.chat.createChatParticipant(
      "mr-context.agent",
      async (
        request: vscode.ChatRequest,
        _chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
      ) => {
        try {
          const skill = detectSkill(request.prompt, request.command) as SkillName;

          stream.progress("Searching semantic graph…");
          const agent = await getAgent(token);

          // For review skill, append any active editor selection to the message
          let userMessage = request.prompt;
          if (skill === "review") {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const sel = editor.document.getText(editor.selection);
              if (sel.trim()) {
                userMessage += `\n\n\`\`\`${editor.document.languageId}\n${sel}\n\`\`\``;
              }
            }
          }

          stream.progress("Reasoning…");
          for await (const chunk of agent.chat(userMessage, token, skill)) {
            stream.markdown(chunk);
          }
        } catch (err) {
          stream.markdown(`**Mr. Context error:** ${(err as Error).message}`);
        }
      }
    );

    participant.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "mr-context-icon.svg"
    );
    // isSticky is declared in package.json contributes.chatParticipants; not set at runtime.
    context.subscriptions.push(participant);
  } catch {
    // vscode.chat API may not be present in older VS Code builds
    console.warn("[mr-context] Chat participant API unavailable in this VS Code version.");
  }
}

export function deactivate(): void {
  resetAgent();
}
