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

Create a `.mrcaconfig` in your project root (copy `.mrcaconfig.example`), then:

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

---

## How It Works

1. **Extraction** — Repomix fetches source files from configured GitHub repositories
2. **Syntactic graph** — Exports, imports, and design patterns extracted without any LLM
3. **Semantic enrichment** — VS Code LM API (Copilot) generates natural-language summaries for each node
4. **Query** — BM25 + LLM rescoring retrieves the most relevant nodes for any question
5. **Deliver** — Context block injected into the Copilot Chat prompt

```
mrc build  →  .mrc-graph.json  →  @mrc query  →  Copilot answer
```

---

## Configuration

Create `.mrcaconfig` in your project root:

```json
{
  "repositories": [
    "https://github.com/your-org/your-api",
    "https://github.com/your-org/your-shared-types"
  ],
  "branch": "main",
  "maxContextNodes": 25
}
```

Set `GITHUB_TOKEN` environment variable for private repositories.

---

## Repository

**GitHub:** https://github.com/eonio-dev/mr-context  
**npm:** https://www.npmjs.com/package/mr-context  
**License:** MIT
