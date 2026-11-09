---
"@docture/cli": minor
---

Invalid arguments to the MCP `convert`, `inspect`, and `extract` tools now return an `isError` result with code `USAGE` and a hint, instead of a JSON-RPC error, so the model can read and correct them. A tool name the server does not list is still a JSON-RPC error, including `list_schemas` without `schemas`, an unconfigured or misspelled Paperless tool, and `paperless_apply` without `enableApply`. Hints in MCP tool errors no longer name CLI flags, and an unknown `schemaName` on a server with only a default `schema` says to omit it.
