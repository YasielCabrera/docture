# Write a custom extraction strategy

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Implement `defineStrategy()` for the table in the local supply invoice. PDF.js supplies positioned lines; the strategy returns data that Docture validates against the schema.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples plugins
```

The result contains all five supply rows with descriptions, quantities, unit prices, and amounts. The rows sum to `$664.17`; sales tax adds `$53.13`, for a total of `$717.30`.

`custom-loader.ts` demonstrates `defineLoader()` with the adjacent `items.csv`. The CSV contains the same five quantities and amounts, keyed by SKU. It demonstrates a native format-specific input.

```sh
pnpm --filter @docture/examples exec tsx your-own-plugins/custom-loader.ts
```

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).
