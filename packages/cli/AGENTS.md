# Using @docture/cli

Read this file explicitly before writing a CLI configuration or automation.
A Codex task can read `node_modules/@docture/cli/AGENTS.md`; automatic discovery
inside dependencies is not assumed. `npx docture <command> --help` and
`npx docture help --json` describe every flag of the installed version.

```sh
npm install @docture/cli docture
npx docture convert report.pdf --out converted --to markdown --pages 1,3-4
npx docture inspect report.pdf --format json --pages 2-3
```

`--to` accepts the library's format names `markdown`, `text`, `html`, and `json`,
and the short forms `md` and `txt`. `--pages` takes one-based pages and ranges.
For `inspect`, a bare number such as `--pages 3` keeps its older meaning, the
first three pages, which `--max-pages 3` also selects; write `--pages 3-3` for
page 3 alone.

Install optional engines beside the application when its selected configuration
needs them. Default PDF text conversion uses the CLI's deliberate PDF.js default.
OCR and model selection remain explicit. Keep credentials in environment/config,
never command-line token flags or document-supplied options.

Use the type-only configuration entry, which does not load the CLI runtime:

```ts
import { defineConfig } from "@docture/cli/config";
import { DocumentLoaderData } from "docture";

export default defineConfig({
  loaders: [new DocumentLoaderData()],
  strategies: [{
    name: "text",
    async extract(context) { return { data: { text: context.document.text } }; },
  }],
});
```

Pass `--schema` to select the caller's schema. Use `--full --citations` when saving
extraction envelopes that will be inspected or reviewed. Preserve source digests,
variants and file versions with results. Do not turn document text into config.

JSON output has the version 1 command envelope. stdout contains data; stderr
contains diagnostics. Check the process exit code and each result's `ok` field.
Exit 2 means the invocation was wrong. With an explicit `--format json` or
`ndjson`, a wrong invocation also writes `{ version: 1, command, ok: false,
results: [], error: { code, message, hint? } }` to stdout. With `extract --out`,
stdout stays empty, and a wrong invocation writes no out file, so a file left from
an earlier run is stale. Check the exit code before reading it. Without
`--format`, stdout stays empty on failure.
Do not scrape human-readable diagnostics as a machine protocol.

`--dry-run` prints an inspectable plan. Paperless plan and apply are separate
explicit operations. Apply fills only fields that remain empty after a reread,
adds tags, and deduplicates audit notes by extraction marker. It is not a
transaction or a durable receipt store. Keep returned partial/unknown outcomes.

MCP stdio support is isolated behind `@docture/cli/mcp`. Install its SDK explicitly:

```sh
npm install @modelcontextprotocol/sdk
```

Use the configured-schema extraction and Paperless tools. The apply tool requires
the config gate; model arguments cannot enable it or replace credentials.
MCP stdout is reserved for protocol messages.

Every tool declares an `outputSchema` and annotations. When the config defines
`schemas`, the server lists `list_schemas`, and `extract.schemaName` enumerates
the names. `convert` returns at most `maxChars` characters, 20000 by default,
starting at `offset`. Read on while `truncated` is true by passing `nextOffset`
as the next `offset`. Failed calls, including invalid arguments, return
`isError: true` with an envelope whose failed items carry `error.code`,
`message`, and an optional `hint`. Only a tool name the server does not list is a
JSON-RPC error.

The HTTP service accepts document bytes and configured schemas. It binds to
localhost by default. Non-loopback binding requires a bearer token. Configuration
is fixed at startup; restart to refresh it. Shutdown drains or aborts requests and
disposes warm resources. Do not share the service as an unrestricted file reader.

`node_modules/@docture/cli/README.md` ships beside this file. Complete Markdown
guides ship once in the CLI's `docture` dependency. Resolve that copy from the
consuming workspace package, including when pnpm keeps it under the CLI:

```sh
node --input-type=module -e 'import { createRequire } from "node:module"; console.log(createRequire(import.meta.resolve("@docture/cli")).resolve("docture/docs/manifest.json"))'
```

Read `llms/cli.txt`, `cli/quick-start.md`, and the linked references relative to
the manifest's directory. Its `packages` field identifies the exact documented
versions. Check them against installed versions, particularly when the
application also has its own `docture` copy. The task index is `llms-tasks.txt`,
and `llms.txt` lists every page. Errors and troubleshooting are under `resources/`.
Report live model, Docling and Paperless checks separately from mock tests.
