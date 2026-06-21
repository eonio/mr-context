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
