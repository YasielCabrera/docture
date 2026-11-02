# Extract a supply invoice

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Read the local `invoice.pdf`, define the expected fields, and extract its invoice number and total. The parser handles this supply layout. Use [model extraction](../with-a-model) for documents with unfamiliar layouts.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples quick-start
```

The result contains invoice number `INV-2026-0142`, total `717.3`, method `supply-invoice`, and loader `pdfjs`.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).
