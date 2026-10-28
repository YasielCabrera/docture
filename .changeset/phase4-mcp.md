---
"@docture/cli": minor
---

`docture mcp` serves Docture to an agent host over Model Context Protocol stdio, and the new `@docture/cli/mcp` entry exports `createMcpServer({ io, signal?, configPath?, noConfig? })` for any SDK transport. The server has two model-free tools. `convert` takes `{ source, format? }` with Markdown, HTML, text, or JSON, and returns the content without writing files. `inspect` takes `{ source, pages? }`. Both return the CLI's version 1 envelope as structured content and JSON text, and a failed document sets `isError` with the CLI error code. Stdout carries only protocol frames, and the server stops at end of input or on Ctrl-C.

`@modelcontextprotocol/sdk@1.32.2` is a new optional peer. Install it to use `docture mcp`; no other command or the root entry loads it.
