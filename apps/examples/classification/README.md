# Classify an invoice and a statement

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Define document kinds with their schemas and register a classifier that recognizes headings. Read the two local PDFs independently.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples classify
```

The supply invoice PDF is `invoice`; the Carson PDF is `bank-statement`. The classifier abstains if the matching kind is absent from the candidates.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).

[Carson Bank statement source](https://www.carsonbank.com/wp-content/uploads/2021/01/Sample-Statement.pdf).
