# Using @docture/cli

Read this file explicitly before writing a CLI configuration or automation.
A Codex task can read `node_modules/@docture/cli/AGENTS.md`; automatic discovery
inside dependencies is not assumed. The documentation's [/llms.txt](http://localhost:3100/llms.txt) indexes guides when running locally.

```sh
npm install @docture/cli docture
npx docture convert report.pdf --out converted --to json --pages 1,3
npx docture inspect report.pdf --format json
```

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
Do not scrape human-readable diagnostics as a machine protocol.

`--dry-run` prints an inspectable plan. Paperless plan and apply are separate
explicit operations. Apply fills only fields that remain empty after a reread,
adds tags, and deduplicates audit notes by extraction marker. It is not a
transaction or a durable receipt store. Keep returned partial/unknown outcomes.

MCP stdio support is isolated behind `@docture/cli/mcp`. Install its SDK explicitly:

```sh
npm install @modelcontextprotocol/sdk@1.32.2
```

Use the configured-schema extraction and Paperless tools. The apply tool requires
the config gate; model arguments cannot enable it or replace credentials.
MCP stdout is reserved for protocol messages.

The HTTP service accepts document bytes and configured schemas. It binds to
localhost by default. Non-loopback binding requires a bearer token. Configuration
is fixed at startup; restart to refresh it. Shutdown drains or aborts requests and
disposes warm resources. Do not share the service as an unrestricted file reader.

Use the symptom-based troubleshooting guide and error reference for recovery.
Report live model, Docling, Paperless and Azure checks separately from mock tests.
