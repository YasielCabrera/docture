# 16-document-conversion

> Convert one generated, layout-rich PDF to grounded Markdown with page provenance and
> referenced raster assets.

**Needs:** nothing. No download, key, OCR model, or network.

```sh
pnpm --filter @docture/examples convert
```

The example uses `DocumentConverter` as a peer to `Extractor`. PDF.js supplies text,
geometry, typography, links, and embedded images. Core derives semantic elements and
exports Markdown without asking a model to rewrite source text.

Change `format` to `text` or `html`, and `assets` to `embedded` or `omit`, to exercise the
other built-in modes.
