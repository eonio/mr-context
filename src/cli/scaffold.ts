// src/cli/scaffold.ts
// Copilot customization assets scaffolded into a workspace by `mrc init`:
//   - .github/copilot-instructions.md        (managed block: token discipline)
//   - .github/chatmodes/mrc.chatmode.md      (deterministic, minimal-output agent)
//   - .github/instructions/mrc-tools.instructions.md  (deterministic tool list + guardrails)
//   - .github/prompts/mrc-locate.prompt.md   (semantic locate skill)
//   - .github/prompts/mrc-trace.prompt.md    (dependency trace skill)
//   - .github/prompts/mrc-edit.prompt.md     (token-efficient edit skill)
//
// Single rule across every asset: minimize tokens. Agents call deterministic
// mrc tools first, read narrowly, and emit results — not reasoning.

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { dirname, resolve } from "path";
import chalk from "chalk";

export const MRC_BLOCK_START = "<!-- mr-context:start -->";
export const MRC_BLOCK_END = "<!-- mr-context:end -->";

// ── .github/copilot-instructions.md (managed block) ──────────────────────────
export const COPILOT_INSTRUCTIONS = `${MRC_BLOCK_START}
## Mr. Context — Token Shield (read first)

This workspace is pre-indexed by [Mr. Context](https://github.com/eonio/mr-context)
into a semantic graph spanning every configured repo. The graph already knows
every file, export, import, signature, and design pattern across repos. Use it
instead of reading files to "understand" the codebase.

### Hard rules (token discipline)
1. **mrc-first.** Before reading files or answering any codebase question, call
   \`#mrcAsk\` with the user's request. Use its ranked context to answer.
2. **Results, not reasoning.** Do NOT narrate a plan, plan aloud, or stream
   step-by-step thinking. No "Let me…", no "I'll start by…". Emit the final
   answer/diff only.
3. **Read narrowly.** Never open a whole file to learn structure — \`#mrcAsk\` /
   \`#mrcSearch\` return signatures. Open a file only to edit it or to read one
   specific span you already located.
4. **No guessing.** Never invent file paths, exports, or signatures. If it's not
   in the graph result, locate it with a tool first.
5. **Stop when answered.** Don't call more tools to re-confirm what a result
   already states.

### Tools (deterministic first)
| Need | Use | Not |
|---|---|---|
| Understand / locate by meaning | \`#mrcAsk\`, \`#mrcSearch\` | reading files, \`codebase\` |
| Trace imports / impact | \`#mrcDependencies\` | manual grep chains |
| Find a design pattern | \`#mrcPattern\` | scanning folders |
| File metadata (exports/signature) | \`#mrcFile\` | opening the file |
| Exact string | \`search\` (text) | \`#mrcAsk\` |
| Edit / create / delete | \`editFiles\` | re-reading to "understand" first |

### Output format
- Lead with the answer. Cite as \`path:line\`. Prefer tables/lists over prose.
- Code blocks only for code. No filler, no restating the question.
${MRC_BLOCK_END}
`;

// ── .github/chatmodes/mrc.chatmode.md ────────────────────────────────────────
export const CHATMODE_MRC = `---
description: 'Deterministic, token-minimal codebase agent backed by the Mr. Context graph. Locates, traces, and edits across repos with the fewest tokens.'
tools: ['mrcAsk', 'mrcSearch', 'mrcDependencies', 'mrcPattern', 'mrcFile', 'search', 'editFiles', 'problems']
---
# Mr. Context Agent

You answer codebase questions and make edits across multiple repositories using
the Mr. Context semantic graph. Optimize for **fewest tokens, correct result**.

## Operating loop (Agentic)
1. **Retrieve** — call \`#mrcAsk\` once with the full request. It returns ranked,
   cross-repo context (paths + signatures). Add \`#mrcDependencies\`/\`#mrcPattern\`
   only if the task needs impact analysis or pattern enumeration.
2. **Act** — answer directly, or edit with \`editFiles\` at the located \`path:line\`.
3. **Verify** — check \`problems\` after edits. Stop.

## Rules
- Do not read whole files to understand structure — the graph already has it.
  Open a file only to edit it or read one specific located span.
- Never call \`codebase\` (workspace embedding search); \`#mrcAsk\` supersedes it.
- One retrieval is usually enough. Don't re-query to confirm.
- Never invent paths/exports/signatures. Cite \`path:line\` from tool output.

## Output
- Results only — no plan narration, no "thinking out loud".
- Lead with the answer; tables/lists over prose; code blocks only for code.
- For edits: a one-line summary + the diff. Nothing else.
`;

// ── .github/instructions/mrc-tools.instructions.md ───────────────────────────
export const INSTRUCTIONS_TOOLS = `---
applyTo: '**'
---
# Deterministic tools — search, edit, create, delete, find

Prefer deterministic tools over generation or whole-file reads. This keeps output
clean and cheap. The Mr. Context graph is pre-built; treat it as ground truth for
"where/what/how things relate".

## Find & understand (semantic, via Mr. Context)
| Task | Tool | Output is |
|---|---|---|
| Find code by meaning / "where is X" | \`#mrcAsk\` | ranked paths + signatures |
| List files matching an intent | \`#mrcSearch\` | ranked file list |
| What a file depends on / impacts | \`#mrcDependencies\` | import graph (N hops) |
| Files implementing a pattern | \`#mrcPattern\` | grouped file list |
| One file's exports/imports/signature | \`#mrcFile\` | metadata, no body |

## Find (exact, deterministic)
- Exact string/symbol → \`search\` (text/regex). Use when you know the literal.

## Mutate (deterministic file ops)
- Edit / create / delete → \`editFiles\`. Locate the target with \`#mrcAsk\`/\`#mrcFile\`
  FIRST, then edit at \`path:line\`. Do not re-read the file to "understand" it.

## Guardrails (always)
- **Token budget:** one retrieval per task; don't re-query to confirm.
- **Narrow reads:** request a specific symbol/span, never an entire file for context.
- **No hallucinated paths:** every path/symbol must come from a tool result.
- **Structured output:** \`path:line\` citations, tables/lists, code blocks for code only.
- **Results, not reasoning:** no plan narration; emit the final answer/diff.
`;

// ── .github/prompts/*.prompt.md ──────────────────────────────────────────────
export const PROMPT_LOCATE = `---
mode: 'agent'
description: 'Locate code by meaning across all indexed repos, token-minimally.'
tools: ['mrcAsk', 'mrcSearch', 'mrcFile']
---
Locate where the following exists or is implemented across the indexed repos:

"\${input:query:what to find}"

Steps: call \`#mrcAsk\` once. Return ONLY a table of \`path:line\` | repo | one-line role.
No prose, no reasoning. If nothing matches, say so in one line.
`;

export const PROMPT_TRACE = `---
mode: 'agent'
description: 'Trace dependencies/impact of a file using the Mr. Context graph.'
tools: ['mrcDependencies', 'mrcFile']
---
Trace the dependency/impact graph for: \${file}

Call \`#mrcDependencies\` (2 hops). Return ONLY:
1. A bullet list of upstream deps (what it imports).
2. A bullet list of downstream impact (what imports it), if available.
Cite \`path\`. No narration.
`;

export const PROMPT_EDIT = `---
mode: 'agent'
description: 'Make a token-efficient, located edit without whole-file reads.'
tools: ['mrcAsk', 'mrcFile', 'search', 'editFiles', 'problems']
---
Task: \${input:task:describe the change}

1. Locate the exact target with \`#mrcAsk\`/\`#mrcFile\` (get \`path:line\` + signature).
   Do NOT read the whole file to understand it.
2. Apply the edit with \`editFiles\` at the located span.
3. Check \`problems\`; fix only real errors you introduced.

Output: one-line summary + the diff only. No plan, no reasoning.
`;

// ── Writer ───────────────────────────────────────────────────────────────────

interface Asset {
  relPath: string;
  content: string;
  managed?: boolean; // copilot-instructions: append/replace a delimited block
}

const ASSETS: Asset[] = [
  { relPath: ".github/copilot-instructions.md", content: COPILOT_INSTRUCTIONS, managed: true },
  { relPath: ".github/chatmodes/mrc.chatmode.md", content: CHATMODE_MRC },
  { relPath: ".github/instructions/mrc-tools.instructions.md", content: INSTRUCTIONS_TOOLS },
  { relPath: ".github/prompts/mrc-locate.prompt.md", content: PROMPT_LOCATE },
  { relPath: ".github/prompts/mrc-trace.prompt.md", content: PROMPT_TRACE },
  { relPath: ".github/prompts/mrc-edit.prompt.md", content: PROMPT_EDIT },
];

// Scaffold every Copilot asset. Existing files are preserved unless `force`.
// The copilot-instructions managed block is appended (or replaced on force)
// without touching the user's own content.
export function scaffoldCopilotAssets(cwd: string, force: boolean): void {
  for (const asset of ASSETS) {
    const filePath = resolve(cwd, asset.relPath);
    asset.managed
      ? writeManaged(filePath, asset.relPath, asset.content, force)
      : writePlain(filePath, asset.relPath, asset.content, force);
  }
}

function writePlain(filePath: string, relPath: string, content: string, force: boolean): void {
  const existed = existsSync(filePath);
  if (existed && !force) {
    console.log(chalk.yellow("  skip  ") + chalk.gray(`${relPath} already exists (--force to overwrite)`));
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  console.log(chalk.green(existed ? "  update" : "  create") + `  ${relPath}`);
}

function writeManaged(filePath: string, relPath: string, block: string, force: boolean): void {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, block, "utf-8");
    console.log(chalk.green("  create") + `  ${relPath}`);
    return;
  }

  const existing = readFileSync(filePath, "utf-8");
  const blockRe = new RegExp(`${escapeRe(MRC_BLOCK_START)}[\\s\\S]*?${escapeRe(MRC_BLOCK_END)}\\n?`, "m");

  if (blockRe.test(existing)) {
    if (!force) {
      console.log(chalk.yellow("  skip  ") + chalk.gray(`${relPath} already contains Mr. Context block (--force to refresh)`));
      return;
    }
    writeFileSync(filePath, existing.replace(blockRe, block), "utf-8");
    console.log(chalk.green("  update") + `  ${relPath}`);
    return;
  }

  appendFileSync(filePath, `\n${block}`, "utf-8");
  console.log(chalk.green("  append") + `  ${relPath}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
