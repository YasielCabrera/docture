# @docture/cli

## 0.1.0

### Minor Changes

- c1e0730: Add `@docture/cli`, the `docture` command line: `extract`, `classify`, `inspect` and
  `eval`.

  ```sh
  npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
  ```

  **stdout carries the data and stderr carries the story**, so the command above pipes into
  `jq` while still reporting which strategy answered, what it cost, and every attempt that
  failed first. Exit codes separate "a document failed" (1) from "the command was wrong" (2),
  which is the distinction a CI job needs.

  `--schema` takes a module. Zod, Valibot, ArkType, or a `.json` JSON Schema, with no build
  step, because Node strips TypeScript itself from 22.18 on. `--model <provider>/<model-id>`
  resolves the provider package from the working directory and falls back to the AI Gateway,
  saying which route it took and warning about a missing credential _before_ the first request.
  When flags are not enough, `docture.config.ts` supplies real loaders, strategies and a real
  model instance built by your own imports; a flag always wins over it, and where it cannot,
  the run says the flag was ignored.

  `inspect` needs no model and no API key. It answers "why did no strategy run?", and
  it reports the features core actually routed on rather than re-deriving them. `eval` scores a
  corpus with `@docture/eval` and exits 1 below `--min-f1`.

  The only heavy dependency is optional: `@docture/raster-canvas` carries the one native binding
  in the tree, so a platform without a prebuild can still install a CLI that reads text, and
  `--vision` fails by name rather than at install time.

### Patch Changes

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

- Updated dependencies [c1e0730]
- Updated dependencies [c1e0730]
  - @docture/core@0.1.0
  - @docture/llm@0.1.0
  - @docture/loader-pdfjs@0.1.0
  - @docture/eval@0.0.2
