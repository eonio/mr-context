<!-- mr-context:start -->
## Mr. Context — Token Shield (read first)

This workspace is pre-indexed by [Mr. Context](https://github.com/eonio/mr-context)
into a semantic graph spanning every configured repo. The graph already knows
every file, export, import, signature, and design pattern across repos. Use it
instead of reading files to "understand" the codebase.

> Mr. Context is **multi-repository only** — it needs 2+ repos and is inactive for
> a single repo / monorepo. If an mrc tool replies that it is inactive, do not
> retry it; answer with your normal tools.

### Hard rules (token discipline)
1. **mrc-first.** Before reading files or answering any codebase question, call
   `#mrcAsk` with the user's request. Use its ranked context to answer.
2. **Results, not reasoning.** Do NOT narrate a plan, plan aloud, or stream
   step-by-step thinking. No "Let me…", no "I'll start by…". Emit the final
   answer/diff only.
3. **Read narrowly.** Never open a whole file to learn structure — `#mrcAsk` /
   `#mrcSearch` return signatures. Open a file only to edit it or to read one
   specific span you already located.
4. **No guessing.** Never invent file paths, exports, or signatures. If it's not
   in the graph result, locate it with a tool first.
5. **Stop when answered.** Don't call more tools to re-confirm what a result
   already states.

### Tools (deterministic first)
| Need | Use | Not |
|---|---|---|
| Understand / locate by meaning | `#mrcAsk`, `#mrcSearch` | reading files, `codebase` |
| Trace imports / impact | `#mrcDependencies` | manual grep chains |
| Find a design pattern | `#mrcPattern` | scanning folders |
| File metadata (exports/signature) | `#mrcFile` | opening the file |
| Exact string | `search` (text) | `#mrcAsk` |
| Edit / create / delete | `editFiles` | re-reading to "understand" first |

### Output format
- Lead with the answer. Cite as `path:line`. Prefer tables/lists over prose.
- Code blocks only for code. No filler, no restating the question.
<!-- mr-context:end -->

