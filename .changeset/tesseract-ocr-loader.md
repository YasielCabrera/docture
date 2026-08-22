---
"@docture/loader-tesseract": minor
---

Add `@docture/loader-tesseract`, with `DocumentLoaderTesseract`, OCR backed by tesseract.js
(Tesseract as WASM, no native binary and no system install).

It reads a document that has no text layer, and reports what it finds in exactly the shape
every other loader does: pages, text, and positioned lines in PDF points, top-left origin.
Words also carry `confidence`, which a text layer cannot offer. Pixels come from a
`Rasterizer` passed to the constructor, so "no rasterizer wired" is visible where the loader
is built, and with none passed, `application/pdf` is absent from `capabilities.mimeTypes` and
the pipeline routes PDFs elsewhere. A PNG or JPEG needs no rasterizer at all.

It passes the same `describeLoaderConformance` suite as `DocumentLoaderPdfJs` and `DocumentLoaderMuPdf`, so a
text layer and an OCR pass are held to the same invariants.

Three defaults it corrects on tesseract.js's behalf, each otherwise a silent wrong answer or a
dead process: page segmentation is set explicitly to `--psm 3` (tesseract.js initialises at
`--psm 6`, where layout analysis finds one block and drops a page heading entirely);
`user_defined_dpi` is set from the render resolution, rather than letting Tesseract guess and
warn about it; and an `errorHandler` is always installed, because without one tesseract.js
throws from inside its own worker-message handler and takes the process down. The language
model is cached outside the working directory, not in it.

Line grouping goes through core's `linesFromWords` rather than Tesseract's own block
structure, so an OCR'd page and a text-layer page group identically, and a table row whose
Amount column Tesseract puts in a separate block is reassembled.

The conformance suite and the OCR behaviour tests run real recognition behind `RUN_OCR=1`; the
default test run is offline.
