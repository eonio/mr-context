---
applyTo: '**'
---
# Deterministic tools — search, edit, create, delete, find

Prefer deterministic tools over generation or whole-file reads. This keeps output
clean and cheap. The Mr. Context graph is pre-built; treat it as ground truth for
"where/what/how things relate".

## Find & understand (semantic, via Mr. Context)
| Task | Tool | Output is |
|---|---|---|
| Find code by meaning / "where is X" | `#mrcAsk` | ranked paths + signatures |
| List files matching an intent | `#mrcSearch` | ranked file list |
| What a file depends on / impacts | `#mrcDependencies` | import graph (N hops) |
| Files implementing a pattern | `#mrcPattern` | grouped file list |
| One file's exports/imports/signature | `#mrcFile` | metadata, no body |

## Find (exact, deterministic)
- Exact string/symbol → `search` (text/regex). Use when you know the literal.

## Mutate (deterministic file ops)
- Edit / create / delete → `editFiles`. Locate the target with `#mrcAsk`/`#mrcFile`
  FIRST, then edit at `path:line`. Do not re-read the file to "understand" it.

## Guardrails (always)
- **Token budget:** one retrieval per task; don't re-query to confirm.
- **Narrow reads:** request a specific symbol/span, never an entire file for context.
- **No hallucinated paths:** every path/symbol must come from a tool result.
- **Structured output:** `path:line` citations, tables/lists, code blocks for code only.
- **Results, not reasoning:** no plan narration; emit the final answer/diff.
