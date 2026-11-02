# Extract an invoice with the CLI

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Run these commands from the repository root after installing and building the workspace.

```sh
pnpm --filter @docture/examples cli
```

To invoke the command directly, change to this folder and run:

```sh
pnpm exec docture inspect invoice.pdf
pnpm exec docture extract invoice.pdf --config docture.config.ts
pnpm exec docture convert invoice.pdf --to md
```

`docture.config.ts` wires PDF.js, the parser and the schema from `invoice.ts`. Extraction returns `INV-2026-0142` and total `717.3` without a model key. `index.ts` runs that same command through the CLI's public `run` API.

In your own project, install the CLI with `pnpm add @docture/cli`.

[Document sources](../SOURCES.md).
