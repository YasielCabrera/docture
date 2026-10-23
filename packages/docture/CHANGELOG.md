# docture

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0
  - @docture/llm@0.2.0

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

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0
  - @docture/llm@0.1.0

# Earlier scoped-package releases

The following entries describe releases before the implementations moved into `docture`. Package names and versions in this history are historical.

## @docture/core before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

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

## @docture/llm before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

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

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/eval before consolidation

## 0.0.3

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/loader-pdfjs before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

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

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/loader-mupdf before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

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

- c1e0730: Add `@docture/loader-mupdf`, with `DocumentLoaderMuPdf` and `MuPdfRasterizer`, both backed by MuPDF
  compiled to WASM.

  `DocumentLoaderMuPdf` reads text and positioned geometry; `MuPdfRasterizer` renders pages to PNG or
  JPEG. They stay separate plugins, so either can be swapped alone, but ship in one package
  because they share one WASM engine from one dependency.

  `DocumentLoaderMuPdf` passes the same `describeLoaderConformance` suite as `DocumentLoaderPdfJs`, and
  `MuPdfRasterizer` the same `describeRasterizerConformance` suite as `NapiCanvasRasterizer`, so
  swapping either is an import change. Unlike the pdf.js pair there is no native binary anywhere
  in the tree. The tradeoffs are that MuPDF's calls block the event loop, and that `mupdf` is
  AGPL-3.0-or-later.

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/loader-tesseract before consolidation

## 0.1.1

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

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

- c1e0730: Add `@docture/loader-tesseract`, with `DocumentLoaderTesseract`, OCR backed by tesseract.js
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

### Patch Changes

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

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/loader-paddleocr before consolidation

## 0.1.1

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

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

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/raster-canvas before consolidation

## 0.0.3

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0

## @docture/testing before consolidation

## 0.1.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

- Updated dependencies [a490eef]
  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0
