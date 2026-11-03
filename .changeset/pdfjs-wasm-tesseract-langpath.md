---
"docture": patch
---

PDF.js now decodes JPEG 2000 and JBIG2 images. `NapiCanvasRasterizer` used to render those images as blank areas, so scanned PDFs that use them gave OCR an empty page. `DocumentLoaderPdfJs` now returns them as image assets. PDF.js warnings no longer print to the console.

`DocumentLoaderTesseract` now reads a local `langPath` directory that holds plain `<lang>.traineddata` files, the form docture's cache stores. Before, it looked only for `<lang>.traineddata.gz` and the load never settled. A directory that lacks a language's model now rejects with `MissingComponentError` naming the missing file.
