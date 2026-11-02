# Chunk a multipage statement

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Read the six-page local statement and split it at page boundaries with `chunkByPage()` and `chunkByBudget()`. Parse references from the actual transaction sections, then combine the page results with `mergePartials()`.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples long
```

The six page chunks preserve source page numbers. The merged list contains 48 printed transaction-table rows, including the opening balance row. It excludes checks and daily balance summaries.

For a standalone application, add the model integration.

```sh
pnpm add ai
```

`paginated.ts` demonstrates model extraction with `CompletionStrategy.PAGINATE`. It reads checking-account pages 1 to 3, sends one request per page, and merges the returned transaction arrays.

```sh
AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples exec tsx long-documents/paginated.ts
```

Set `DOCTURE_MODEL` to choose another gateway model. Tests verify pagination with deterministic provider responses.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf).
