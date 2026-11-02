# Try another strategy when a layout differs

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Register two fixed-layout parsers in order. Extract both local invoices, then use `safeExtract()` on a statement that neither parser supports.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples fallback
```

The USD supply invoice succeeds on the first strategy. The INR tax invoice records one failed attempt before the second strategy answers. Both vendors use invoice number `INV-2026-0142`, so the strategies recognize their layouts and vendor names. The unsupported statement returns an error outcome.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).

[Carson Bank statement source](https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf).

[Larkfield tax invoice source](https://filedone.ai/sample-files/sample-invoice.pdf).
