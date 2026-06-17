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

Create a `.mrc/config.json` in your project root, then:

```bash
mrc build        # Index repositories into a semantic graph
mrc info         # Show graph statistics
mrc search "payment routing"  # Search without an LLM
```

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=eonio-dev.mr-context) or from a `.vsix` file, then use `@mrc` in Copilot Chat:

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

Tools: `mrc_ask`, `mrc_search`, `mrc_dependencies`, `mrc_pattern`, `mrc_file`.
Resource: `mrc://repositories` (configured + indexed repos, graph stats).

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

1. **Extraction** — Repomix fetches source files from configured GitHub repositories
2. **Syntactic graph** — Exports, imports, and design patterns extracted without any LLM
3. **Semantic enrichment** — VS Code LM API (Copilot) generates natural-language summaries for each node
4. **Query** — BM25 + LLM rescoring retrieves the most relevant nodes for any question
5. **Deliver** — Context block injected into the Copilot Chat prompt

```
mrc build  →  .mrc/data/graph.json  →  @mrc query  →  Copilot answer
```

---

## Configuration

Create `.mrc/config.json` in your project root:

```json
{
  "repositories": [
    "https://github.com/your-org/your-api",
    { "url": "https://github.com/your-org/your-shared-types", "branch": "develop" }
  ],
  "branch": "main",
  "maxContextNodes": 25
}
```

Each repository is either a URL string (which uses the top-level `branch`) or an
object `{ "url": ..., "branch": ... }` to pin a per-repo branch. The top-level
`branch` is the default for any string entry (falls back to `main`).

Set `GITHUB_TOKEN` environment variable for private repositories.

All Mr. Context state lives under `.mrc/`:

```
.mrc/
├── config.json        # your configuration (commit this)
└── data/
    └── graph.json     # generated graph cache (gitignore this)
```

Add `.mrc/data/` to `.gitignore` to keep the generated cache out of version
control, or `.mrc/` to ignore everything.

---

## Repository

**GitHub:** https://github.com/eonio-dev/mr-context  
**npm:** https://www.npmjs.com/package/mr-context  
**License:** MIT
