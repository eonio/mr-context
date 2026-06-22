---
mode: 'agent'
description: 'Locate code by meaning across all indexed repos, token-minimally.'
tools: ['mrcAsk', 'mrcSearch', 'mrcFile']
---
Locate where the following exists or is implemented across the indexed repos:

"${input:query:what to find}"

Steps: call `#mrcAsk` once. Return ONLY a table of `path:line` | repo | one-line role.
No prose, no reasoning. If nothing matches, say so in one line.
