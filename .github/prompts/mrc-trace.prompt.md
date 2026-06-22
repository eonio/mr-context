---
mode: 'agent'
description: 'Trace dependencies/impact of a file using the Mr. Context graph.'
tools: ['mrcDependencies', 'mrcFile']
---
Trace the dependency/impact graph for: ${file}

Call `#mrcDependencies` (2 hops). Return ONLY:
1. A bullet list of upstream deps (what it imports).
2. A bullet list of downstream impact (what imports it), if available.
Cite `path`. No narration.
