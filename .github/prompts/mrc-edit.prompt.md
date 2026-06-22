---
mode: 'agent'
description: 'Make a token-efficient, located edit without whole-file reads.'
tools: ['mrcAsk', 'mrcFile', 'search', 'editFiles', 'problems']
---
Task: ${input:task:describe the change}

1. Locate the exact target with `#mrcAsk`/`#mrcFile` (get `path:line` + signature).
   Do NOT read the whole file to understand it.
2. Apply the edit with `editFiles` at the located span.
3. Check `problems`; fix only real errors you introduced.

Output: one-line summary + the diff only. No plan, no reasoning.
