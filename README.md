# Mr. Context

**Multi-Repository Context Agent for GitHub Copilot**

[![npm version](https://img.shields.io/npm/v/mr-context.svg)](https://www.npmjs.com/package/mr-context)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Mr. Context (`mr-context`) builds a semantic graph of your GitHub repositories and delivers precisely relevant context to GitHub Copilot — reducing hallucinations, eliminating token waste, and making Copilot genuinely aware of your actual codebase.

No external OpenAI API key required. Mr. Context uses the **VS Code LM API** (GitHub Copilot) for all LLM calls.

---

## Quick Start

### CLI (graph building and inspection)

```bash
npm install -g mr-context
```

In an empty workspace folder:

```bash
mrc init         # Scaffold .mrc/config.json (+ Copilot instructions)
# edit .mrc/config.json — add your repos (url + branch)
mrc build        # Clone repos as siblings, build the graph + repomix artifacts
mrc info         # Show graph statistics
mrc search "payment routing"  # Search without an LLM
```

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=eonio.mr-context) or from a `.vsix` file, then use `@mrc` in Copilot Chat:

```
@mrc How does payment routing work?
@mrc /feature Add Apple Pay support
@mrc /review   (with code selected)
@mrc /onboard
@mrc /patterns
```

#### Copilot agent mode (automatic)

Mr. Context also registers as **Language Model Tools**, so Copilot **agent mode**
can pull multi-repository context on its own — no `@mrc` mention required. When you
ask a question about the codebase, the agent can call:

| Tool | Reference | What it does |
|------|-----------|--------------|
| `mr-context_ask` | `#mrcAsk` | One-shot ranked, budgeted context block for a question |
| `mr-context_search` | `#mrcSearch` | Ranked file search over the graph |
| `mr-context_dependencies` | `#mrcDependencies` | Trace a file's import graph N hops |
| `mr-context_pattern` | `#mrcPattern` | Find files implementing a design pattern |
| `mr-context_file` | `#mrcFile` | A single file's graph metadata |

`mr-context_ask` is the cheapest path: it returns a token-budgeted context block in
one call instead of the agent reading whole files. You can also `#`-reference any
tool explicitly in a prompt.

### MCP Server (any agent)

Mr. Context also ships an **MCP stdio server** (`mrc-mcp`) so *any* MCP client —
Claude, Cursor, VS Code, or a custom agent/skill — can query the graph. It is
read-only and ranks with BM25, so **no API key is required**. Build the graph
first with `mrc build`, then register the server.

Tools: `mrc_ask`, `mrc_search`, `mrc_dependencies`, `mrc_pattern`, `mrc_file`,
`mrc_read_file`.
Resources: `mrc://repositories` (configured + indexed repos, graph stats) and
`mrc://repomix/{name}` — the token-efficient packed signatures for each repo, so
an agent can pull a whole repo's public surface in one fetch.

Claude Desktop / Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "mr-context": {
      "command": "mrc-mcp",
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "mr-context": { "type": "stdio", "command": "mrc-mcp" }
  }
}
```

The server resolves `.mrc/config.json` and `.mrc/data/graph.json` from its working
directory. Override with `MRC_CONFIG` / `MRC_GRAPH` environment variables. It
hot-reloads the graph when `mrc build` rewrites the cache — no restart needed.

---

## Step-by-step: Mr. Context + VS Code Copilot

A complete walkthrough, from zero to a token-efficient, multi-repo Copilot. The
goal is that Copilot answers from the **pre-built graph** instead of reading whole
files — which is what burns tokens.

### Step 1 — Install both pieces

```bash
npm install -g mr-context          # the CLI (builds the graph)
```

Then install the **Mr. Context** extension from the VS Code Marketplace (or a
`.vsix`). The CLI builds the graph; the extension serves it to Copilot.

> Prerequisites: Node 20+, `git`, and GitHub Copilot signed in inside VS Code.

### Step 2 — Create a workspace folder

Mr. Context treats a **workspace** as a container: `.mrc/` holds the config and
graph, and each repo is cloned in as a sibling. Make an empty folder and open it
in VS Code:

```bash
mkdir my-product && cd my-product
code .
```

Target layout once you build:

```
my-product/
├── .mrc/            # config + graph + repomix artifacts
├── api/             # clone (a repo)
├── web/             # clone (another repo)
└── shared-types/    # clone (a third repo)
```

### Step 3 — Scaffold config + Copilot assets

```bash
mrc init
```

This generates, idempotently:

| File | Purpose |
|------|---------|
| `.mrc/config.json` | your repo list + include/exclude |
| `.github/copilot-instructions.md` | **Token Shield** — tells Copilot to use the graph first, answer with results not reasoning |
| `.github/chatmodes/mrc.chatmode.md` | a selectable **"Mr. Context Agent"** chat mode |
| `.github/instructions/mrc-tools.instructions.md` | the deterministic tool list + guardrails |
| `.github/prompts/mrc-*.prompt.md` | reusable `/mrc-locate`, `/mrc-trace`, `/mrc-edit` skills |

### Step 4 — Add your repositories

Edit `.mrc/config.json`. Each repo takes a `branch`, an optional clone-folder
`name`, and optional per-repo `includePatterns` / `excludePatterns`:

```json
{
  "repositories": [
    {
      "url": "https://github.com/your-org/api",
      "branch": "main",
      "includePatterns": ["src/**/*.ts"],
      "excludePatterns": ["**/*.test.ts"]
    },
    { "url": "https://github.com/your-org/web", "branch": "main" },
    { "url": "https://github.com/your-org/shared-types", "branch": "develop", "name": "shared-types" }
  ],
  "includePatterns": ["**/*.ts", "**/*.tsx", "**/*.py", "**/*.go"],
  "excludePatterns": ["**/node_modules/**", "**/dist/**"],
  "maxContextNodes": 25,
  "repomix": true
}
```

> **Tip:** mr-context's edge is *cross-repo* context. Add 2+ related repos (e.g. a
> frontend, its backend, and shared types) so Copilot can answer questions that
> span them.

For private repos, export a token first (or use SSH):

```bash
export GITHUB_TOKEN=$(gh auth token)   # or your PAT
```

### Step 5 — Build the graph

```bash
mrc build
```

This clones each repo as a sibling, extracts a deterministic graph (TypeScript
compiler + tree-sitter, **no LLM**), then runs `repomix --compress` to pack each
repo into token-efficient signatures. Inspect the result:

```bash
mrc info                              # nodes, edges, repos, token totals
mrc search "where are webhooks verified"   # BM25 search, no LLM, instant
```

Re-run `mrc build` whenever remote repos change. Locally, the VS Code extension's
**file watcher** keeps the graph live as you edit — no manual rebuild needed.

### Step 6 — Use it in Copilot (three ways)

**a) Agent mode (automatic, recommended).** Open Copilot Chat in **Agent** mode and
just ask. The `copilot-instructions.md` steers Copilot to call `#mrcAsk` first:

```
How does the web app authenticate against the API?
```

Copilot calls `#mrcAsk` once, gets ranked cross-repo context, and answers — instead
of opening dozens of files.

**b) The Mr. Context chat mode.** In the chat mode dropdown, pick **"Mr. Context
Agent"**. It's locked to the deterministic mrc tools and an output style that emits
results, not reasoning — the cheapest mode for codebase Q&A and edits.

**c) Reusable skills (slash commands).** The scaffolded prompts appear as commands:

```
/mrc-locate query: rate-limiter middleware
/mrc-trace          (with a file open)
/mrc-edit task: add an Idempotency-Key header to all POST requests in the api client
```

You can also `#`-reference any tool inline in a normal prompt:

```
Using #mrcDependencies, what breaks if I change the User type in shared-types?
```

### Step 7 — Confirm the token savings

Ask the same architecture question with the extension **disabled** vs **enabled**,
and watch the credits counter at the bottom of each Copilot reply. With the graph,
a general "what is this and how do the repos relate" question typically drops from
~10 credits to ~1, because Copilot reads the graph instead of the files.

> **Pick the right effort.** For codebase Q&A, a **low** reasoning effort + the
> Mr. Context mode is the cheapest. Save **medium/high** effort for `/mrc-edit` and
> multi-step changes where deeper reasoning actually pays off.

### Token-efficiency cheat sheet

- **Locate, don't browse:** `#mrcAsk` / `#mrcSearch` instead of opening files.
- **Trace, don't grep:** `#mrcDependencies` for impact analysis.
- **One retrieval per task:** the context block is already ranked and budgeted.
- **Edit at `path:line`:** locate first, then `editFiles` — never re-read a file to
  "understand" it before editing.
- **Keep 2+ repos indexed:** cross-repo answers are the whole point.

---

## How It Works

1. **Clone** — Each configured repo is cloned at its branch as a sibling of `.mrc`
   in the workspace. Existing clones are fast-forwarded; clones with uncommitted
   changes are preserved and indexed as-is.
2. **Deterministic graph** — Exports, imports, and design patterns are extracted
   with the TypeScript compiler (TS/JS, incl. CommonJS) and tree-sitter
   (Python/Go), with a regex fallback. No LLM. Cross-repo edges link an import to
   another repo's `package.json` entry point.
3. **repomix enrichment** — `repomix --compress` packs each clone into a
   token-efficient signature artifact (`.mrc/data/repomix/<name>.txt`) and stamps
   per-file API signatures onto graph nodes. Still no LLM.
4. **Semantic layer (optional)** — In VS Code, the LM API (Copilot) adds
   embeddings + summaries for hybrid retrieval. The CLI never calls an LLM.
5. **Deliver** — Hybrid (BM25 + embedding) retrieval feeds a token-budgeted
   context block to Copilot Chat, or to any agent via the MCP server.

```
mrc build  →  .mrc/data/graph.json + repomix/  →  @mrc / MCP  →  agent answer
```

---

## Configuration

`mrc init` scaffolds `.mrc/config.json`. Run it in a **workspace** folder — repos
clone in as siblings of `.mrc`:

```
workspace/
├── .mrc/            # config + graph + repomix artifacts
├── project-a/       # clone
├── project-b/       # clone
└── project-c/       # clone
```

```json
{
  "repositories": [
    {
      "url": "https://github.com/your-org/project-a",
      "branch": "main",
      "includePatterns": ["**/*.ts", "**/*.tsx"],
      "excludePatterns": ["**/node_modules/**", "**/*.test.*"]
    },
    { "url": "https://github.com/your-org/project-b", "branch": "develop" }
  ],
  "includePatterns": ["**/*.ts", "**/*.js", "**/*.py", "**/*.go"],
  "excludePatterns": ["**/node_modules/**", "**/dist/**"],
  "maxContextNodes": 25,
  "repomix": true
}
```

Each repo is a URL string or an object `{ url, branch, name?, includePatterns?,
excludePatterns? }`. `branch` defaults to `main`; `name` overrides the clone
folder name; per-repo `includePatterns`/`excludePatterns` override the top-level
defaults. Set `repomix: false` to skip repomix enrichment.

Set the `GITHUB_TOKEN` environment variable for private repositories (or use SSH).

All Mr. Context state lives under `.mrc/`:

```
.mrc/
├── config.json        # your configuration (commit this)
├── .gitignore         # ignores data/
└── data/
    ├── graph.json     # generated graph cache
    └── repomix/       # packed per-repo signature artifacts
```

`mrc build` keeps the cloned sibling folders out of version control via a managed
block in the workspace root `.gitignore`.

---

## Repository

**GitHub:** https://github.com/eonio/mr-context  
**npm:** https://www.npmjs.com/package/mr-context  
**License:** MIT
