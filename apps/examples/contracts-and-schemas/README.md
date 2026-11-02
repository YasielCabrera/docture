# Define the extraction contract

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Name a Zod schema with `contract()`, then extract the local supply invoice. The return type comes from the schema.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples contracts
```

The customer tax identifier is `null` because the PDF prints only the seller's tax ID. The field remains present because the schema requires a nullable value.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).
