# Read PDF files and bytes

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Extract the local Larkfield tax invoice through PDF.js and MuPDF. Each loader reads the same document from a file path and from a byte source with an explicit media type.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples loaders
```

All four extractions return page `[1]` and total `17348.36`.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod pdfjs-dist mupdf
```

The sample PDF is bundled beside the code. [Original document](https://filedone.ai/sample-files/sample-invoice.pdf).
