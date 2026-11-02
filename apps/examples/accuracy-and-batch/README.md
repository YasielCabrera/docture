# Score a batch of invoices

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Extract both local invoice PDFs with bounded concurrency. Compare each result with the corresponding complete answer in `truth.json` using `looseEval()`.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples accuracy
```

Both two-field extractions score F1 `1`. The USD supply invoice has total `717.3`; the INR tax invoice has total `17348.36`. These values describe the bundled fixed-layout parsers and these two PDFs; they do not measure general invoice accuracy.

For a standalone application, install the integrations used here.

```sh
pnpm add docture @docture/eval zod pdfjs-dist
```

The sample PDF is bundled beside the code. [Original document](https://raw.githubusercontent.com/Egrarobo/apify-actors/main/pdf-tables-to-rows/samples/invoice-us-ruled.pdf).

[Larkfield tax invoice source](https://filedone.ai/sample-files/sample-invoice.pdf).
