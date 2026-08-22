# @docture/core

## 0.1.0

### Minor Changes

- c1e0730: Reshape the public interface along ExtractThinker's vocabulary, with the types kept.

  **`Extractor` is a class, built fluently or declaratively.**

  ```ts
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadLlm(new LLM(openai("gpt-5")), { vision: true, classify: true });
  ```

  `createExtractor({ ... })` still works and returns the same class, so options-object
  wiring (a config file, a factory) is unchanged. `extract` still returns the full
  `ExtractionResult`; `extractData` is the new one-liner for the fields alone.

  **`Process`, `Splitter`, `ImageSplitter`, `TextSplitter`.** A bundle holding several
  documents is read once, cut, and extracted per document. `split()` is lazy and captures
  the classification list in the return type, so the result is a discriminated union.

  **`contract(...)`** names a schema for prompts and reports. Optional everywhere: every
  call that takes a contract also takes a bare schema, and infers the same type.

  **`CompletionStrategy`, `SplittingStrategy`, `ClassificationStrategy`** are constants that
  ARE their string literals, so both `CompletionStrategy.PAGINATE` and `"paginate"` work.

  **`docture`** is a new facade package: `core` + `llm` through one import.

  **Loaders are named `DocumentLoader<Library>`.** `DocumentLoaderPdfJs`,
  `DocumentLoaderMuPdf`, `DocumentLoaderTesseract`, `DocumentLoaderPaddleOcr`, with the old
  `<Library>Loader` names kept as aliases, and `<Library>Config` alongside
  `<Library>LoaderOptions`. `DocumentLoaderData` is new, and lives in core because it wraps
  no library.

  **Also new:** `Classification` takes an `extractor` and an `extractionContract`;
  `ClassificationTree` with `extractor.classifyTree`; `ClassificationResponse` carries the
  matched candidate; a `LoadedSource` skips the load stage for a document you have already
  read; `RunOptions.pages` narrows a run to a page range.

  **Fixed:** a classifier answering with a name outside the candidate list could win,
  making `ClassificationResult.name` an arbitrary string. Verdicts are now reconciled
  against the candidates, case-insensitively, reporting the candidate's spelling. An
  unmatched answer becomes `UNKNOWN` with its signal still recorded.

- c1e0730: Add `@docture/loader-paddleocr`, with `DocumentLoaderPaddleOcr`, OCR backed by PaddleOCR's ONNX models via
  ppu-paddle-ocr. A second OCR engine behind the same contract, so the choice of engine is an
  import rather than a migration.

  It reports what it finds in exactly the shape every other loader does: pages, text, and
  positioned lines in PDF points, top-left origin, with `confidence` on every span. Pixels come
  from a `Rasterizer` passed to the constructor, so "no rasterizer wired" is visible where the
  loader is built, and with none passed, `application/pdf` is absent from `capabilities.mimeTypes`
  and the pipeline routes PDFs elsewhere. A PNG or JPEG needs no rasterizer at all.

  It passes the same `describeLoaderConformance` suite as `DocumentLoaderPdfJs`, `DocumentLoaderMuPdf` and
  `DocumentLoaderTesseract`. Against Tesseract it holds up better on photographs, rotated and
  low-contrast scans, and non-Latin scripts. PaddleOCR ships a recognizer per script, selected
  by name (`model: "v5Cyrillic"`), while reporting coarser geometry, a box per detected region
  rather than per word, and needing `onnxruntime-node`'s prebuilt binding where Tesseract is pure
  WASM. Neither dominates; `@docture/eval` over your own corpus is the way to decide.

  Four of ppu-paddle-ocr's defaults are corrected on its behalf, each otherwise a silent wrong
  answer. Its result cache is bypassed on every call: it is a process-global LRU keyed on a
  32-bit hash of an image's first 1024 bytes plus its length. Two pages of one scan share a
  PNG header, so they can collide and serve each other's text. The key also omits every option
  that changes the answer. Bytes are converted to an exactly-sized `ArrayBuffer` rather than
  handed over as `bytes.buffer`, which for a pooled Node `Buffer` would pass an 8 KB slab of
  unrelated data (and `Buffer.prototype.slice` returns a view, not a copy, so the obvious fix is
  also wrong). Debug image dumps stay off, because they are written to the working directory. And
  the engine is loaded with `await import()` at first use, so constructing the loader is free and
  a pipeline that never OCRs a page never loads the ONNX runtime.

  Line grouping goes through core's `linesFromWords` rather than PaddleOCR's own, so an OCR'd
  page and a text-layer page group identically, with the band **derived from the region
  padding** rather than taken from core's default. PaddleOCR reports each box padded by a
  fraction of its own height, so the stock 0.5 would band at 0.9 of a line of text, nearly twice
  as loosely as every other loader on a document whose text has not changed.

  `imageSize` is now exported from `@docture/core`. Reading pixel dimensions from a PNG or JPEG
  header is something every OCR loader needs, since an OCR loader handed a bare image has no
  page size to report. The alternative was a second copy of a JPEG segment walker in a second
  package.
  `@docture/loader-tesseract` now imports it from core instead of carrying its own; no behaviour
  change.

  The conformance suite and the OCR behaviour tests run real recognition behind `RUN_OCR=1`; the
  default test run is offline.
