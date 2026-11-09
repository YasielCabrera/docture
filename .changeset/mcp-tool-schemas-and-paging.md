---
"@docture/cli": minor
---

MCP tools now declare an output schema and read-only annotations. `convert` returns at most `maxChars` characters (20000 by default) from `offset` and reports `totalChars`, `truncated`, and `nextOffset`, so an agent can read a long document in parts. A part never splits a surrogate pair, even when `maxChars` is 1.
