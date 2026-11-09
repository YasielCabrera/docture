---
"@docture/cli": patch
---

A one-shot command now exits as soon as its output is flushed. Before, work that `--timeout` abandoned could keep the process alive until it settled. `docture mcp` and `docture serve` still run until they shut down.
