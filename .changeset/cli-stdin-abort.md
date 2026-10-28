---
"@docture/cli": patch
---

Interrupting a command that reads a document from `-` now stops the stdin read at once, even when the pipe stays open and sends nothing. The read rejects with the abort reason, releases stdin so the process can exit, and no longer starts reading at all when the run was already aborted. A read that reaches the end of input still returns every byte.
