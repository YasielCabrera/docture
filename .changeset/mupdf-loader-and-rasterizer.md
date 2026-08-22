---
"@docture/loader-mupdf": minor
---

Add `@docture/loader-mupdf`, with `DocumentLoaderMuPdf` and `MuPdfRasterizer`, both backed by MuPDF
compiled to WASM.

`DocumentLoaderMuPdf` reads text and positioned geometry; `MuPdfRasterizer` renders pages to PNG or
JPEG. They stay separate plugins, so either can be swapped alone, but ship in one package
because they share one WASM engine from one dependency.

`DocumentLoaderMuPdf` passes the same `describeLoaderConformance` suite as `DocumentLoaderPdfJs`, and
`MuPdfRasterizer` the same `describeRasterizerConformance` suite as `NapiCanvasRasterizer`, so
swapping either is an import change. Unlike the pdf.js pair there is no native binary anywhere
in the tree. The tradeoffs are that MuPDF's calls block the event loop, and that `mupdf` is
AGPL-3.0-or-later.
