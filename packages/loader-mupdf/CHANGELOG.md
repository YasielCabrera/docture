# @docture/loader-mupdf

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
