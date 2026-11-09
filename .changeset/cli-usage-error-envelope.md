---
"@docture/cli": patch
---

With an explicit `--format json` or `ndjson`, a wrong invocation also writes a version 1 envelope with the error code, message, and hint to stdout. `extract --out` keeps stdout empty and writes no out file for a wrong invocation, so check the exit code before reading the file. Runs without `--format` keep stdout empty on failure.
