# Read an image-only statement with OCR

Standalone copies require the [matching package builds and setup](../README.md#use-a-copied-folder).

Run Tesseract over the local two-page scanned statement. MuPDF renders the page images, including the JBIG2 images in this particular PDF.

Run from the repository root after `pnpm install` and `pnpm build`.

```sh
pnpm --filter @docture/examples scanned
```

The result contains account number `12345678` and `pagesRead: 2`. This runs real OCR; the first run downloads and caches the English recognition model.

For a standalone application, add the vision integrations.

```sh
pnpm add ai pdfjs-dist
```

`vision.ts` reads the first page with a vision model instead of OCR. It extracts the account number and opening and closing balances.

```sh
AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples exec tsx scanned-and-ocr/vision.ts
```

Set `DOCTURE_MODEL` to choose another gateway model.

For a standalone application, install the integrations used here.

```sh
pnpm add docture zod tesseract.js mupdf
```

The sample PDF is bundled beside the code. [Original document](https://www.impact-bank.com/user/file/dummy_statement.pdf).
