# 16-document-conversion

> Convert one generated, layout-rich PDF to grounded Markdown with page provenance and
> referenced raster assets.

**Needs:** nothing. No download, key, OCR model, or network.

```sh
pnpm --filter @docture/examples convert
```

## Imports and installs

Import `DocumentConverter` from `docture`, `DocumentLoaderPdfJs` from
`docture/loaders/pdfjs`, and `makeRichDocumentPdf` from `docture/testing/fixtures`.
The generated fixture needs PDFKit; parsing needs PDF.js.

For a separate application:

```sh
pnpm add docture pdfjs-dist@6.2.108
pnpm add -D pdfkit@0.19.1
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

The example uses `DocumentConverter` as a peer to `Extractor`. PDF.js supplies text,
geometry, typography, links, and embedded images. Core derives semantic elements and
exports Markdown without asking a model to rewrite source text.

Change `format` to `text`, `html`, or `json`, and `assets` to `embedded` or `omit`, to exercise the
other built-in modes.
