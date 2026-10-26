# @docture/examples

A browsable tour of the library, one folder per concept, on **real documents**.

Sixteen examples. Eleven need no API key, and four more run part of the way without one.

Use Node.js 22 or later. From the repository root, install the workspace before running
an example:

```sh
pnpm install
```

The two published packages are `docture` and `@docture/cli`. The private
`@docture/examples` workspace installs all optional engines as development dependencies
so you can run the whole tour. Installing `docture` in your application installs no PDF,
OCR, raster, or model engine. Add the peers for the integrations you use.
The tour's shared runner imports `LLM` for optional model paths, so its keyless scripts
still use the examples workspace's `ai` installation. Your own deterministic pipeline
can import the root API without a model engine.

| Import | Add to your application |
|---|---|
| `docture` | `pnpm add docture` |
| `docture/llm`, `docture/llm/text`, `docture/llm/vision`, `docture/llm/classifier`, `docture/llm/layout`, `docture/llm/split`, `docture/llm/extractor` | `pnpm add ai@^7.0.0 zod@^4` |
| `docture/loaders/pdfjs` | `pnpm add pdfjs-dist@6.2.108` |
| `docture/loaders/mupdf` | `pnpm add mupdf@1.28.0` |
| `docture/loaders/tesseract` | `pnpm add tesseract.js@7.0.0` |
| `docture/loaders/paddleocr` | `pnpm add ppu-paddle-ocr@6.3.0 onnxruntime-node@1.27.0` |
| `docture/raster/canvas` | `pnpm add pdfjs-dist@6.2.108 @napi-rs/canvas@1.0.10` |
| `docture/testing/fixtures` | `pnpm add -D pdfkit@0.19.1` |
| `docture/testing/conformance` | `pnpm add -D 'vitest@>=3' pdfkit@0.19.1` |

The core API comes from `docture`. Evaluation comes from `docture/eval`, and test doubles
come from `docture/testing/doubles`. Those entrypoints need no engine peer. LLM utilities
also have narrow entrypoints: `docture/llm/cache`, `docture/llm/pricing`,
`docture/llm/prompt`, `docture/llm/merge`, and `docture/llm/relax`. Use the broad
`docture/llm` entrypoint for `LLM` and the complete model API, or a narrow entrypoint for
the feature you use. The export map in
[`packages/docture/package.json`](../../packages/docture/package.json) is authoritative.

`pnpm add @docture/cli` installs the CLI with required `ai` and `pdfjs-dist` dependencies.
Its default renderer, `@napi-rs/canvas@1.0.10`, is optional. If optional dependencies were
omitted, install canvas explicitly before using rendering flags such as `--vision`.

Download the corpus once, then start the tour. Use `run fetch` because `pnpm fetch`
is pnpm's own dependency command:

```sh
pnpm --filter @docture/examples run fetch      # ~2 MB, once
pnpm --filter @docture/examples quick-start
```

The offline script runs twelve examples without an API key. Other scripts print explicit
skips for model calls and opt-in OCR when their setup is missing.
Open a folder, read its `index.ts` top to bottom, run it, and the output tells you what
happened and why.

## The examples

| | Folder | What it teaches | Needs |
|---|---|---|---|
| 01 | [quick-start](01-quick-start) | `Extractor` wiring, `contract`, and the result envelope | — |
| 02 | [contracts-and-schemas](02-contracts-and-schemas) | contracts vs schemas, `null` ≠ absent, inferred types, any schema library | — |
| 03 | [loaders-and-sources](03-loaders-and-sources) | pdf.js vs MuPDF, text documents, every `DocumentSource`, `pages` | — |
| 04 | [capabilities-and-composition](04-capabilities-and-composition) | typed capabilities, `withRasterizer`, lazy page images | — |
| 05 | [your-own-plugins](05-your-own-plugins) | `defineStrategy`, `defineLoader`, `defineRasterizer` | — |
| 06 | [fallback-routing-and-errors](06-fallback-routing-and-errors) | eleven layouts, two parsers, fourteen typed errors, timeouts | — |
| 07 | [with-a-model](07-with-a-model) | the AI SDK seam, prompts, caching, cost | key |
| 08 | [long-documents](08-long-documents) | completion strategies, chunking, merging | key¹ |
| 09 | [scanned-and-ocr](09-scanned-and-ocr) | no text layer, OCR as a loader, vision | key / `RUN_OCR=1`¹ |
| 10 | [classification](10-classification) | narrowing, custom + LLM classifiers, consensus, trees | key¹ |
| 11 | [bundles-and-splitting](11-bundles-and-splitting) | `Process`, splitters, unclassified pages, split cost | key¹ |
| 12 | [accuracy-and-batch](12-accuracy-and-batch) | scoring, the truth-completeness trap, `extractBatch` | — |
| 13 | [under-the-hood](13-under-the-hood) | config-driven wiring, read-once, `runPipeline` | — |
| 14 | [testing-your-pipeline](14-testing-your-pipeline) | doubles, fixtures, conformance, mocking a model | — |
| 15 | [cli](15-cli) | `inspect`, `extract`, `classify`, `eval`, a config file | —² |
| 16 | [document-conversion](16-document-conversion) | `DocumentConverter`, TXT/Markdown/HTML/JSON, assets, provenance | — |

¹ Part of the example runs without a key; the rest says what it would have done and skips.
² `extract` and `classify` work keyless through the config file in that folder.

```sh
pnpm --filter @docture/examples offline   # twelve examples without model calls
pnpm --filter @docture/examples all       # everything; skips loudly where a key is missing
pnpm --filter @docture/examples test      # deterministic tests, including provider mocks
pnpm --filter @docture/examples typecheck
```

The `loaders` script makes one HTTP request to demonstrate a URL source, even after the
corpus is downloaded. Here, `offline` means no model calls or OCR model downloads.
Unset `AI_GATEWAY_API_KEY` to run the key-missing branches.

## How these are written

1. **One file, top to bottom, no forward references.** Section banners in the order things
   happen.
2. **A header comment stating the lesson, the command, and what it needs** — before any
   import.
3. **Parsing lives in [`shared/parsers/`](shared/parsers).** No regex longer than a line in
   an `index.ts`. Example 05 is where a parser is written and explained; the rest import
   one. That is the trade that keeps fourteen files from each carrying 200 lines of
   regular expressions.

   The files still run 120–480 lines, because each one covers a whole concept rather than
   a single call. That is the deliberate choice behind sixteen folders instead of forty.
   A fifth to two fifths of every file is comment, and the comments are the teaching.
4. **Print the mechanism, not just the answer.** Which strategy answered, what was tried
   first and why it failed, how many requests, how many renders, what it cost. The output
   is half the example.
5. **Loud skip, exit 0.** A missing download or API key prints a bordered block naming the
   fix. It is not a failure.
6. **No `any`, no casts.** These files are also a type-inference demo — a cast here is a
   bug report against the library.

`shared/` is the plumbing and none of it is the lesson: the document manifest, the
downloader, four text primitives, a table printer, and the parsers.

## The documents

Downloaded rather than committed, for the same reason the library's own fixtures are
generated: a repo should not carry third-party documents it does not own. `documents/` is
gitignored.

`pnpm run fetch` verifies every arrival against the manifest in
[`shared/documents.ts`](shared/documents.ts) — page count and text length for a PDF, PNG
magic bytes and portrait page dimensions for a page image. A sample replaced upstream
fails **there**, loudly, rather than confusingly three examples later.

| | What it is |
|---|---|
| `invoice-odoo` | An Odoo invoice: 4 line items in 2 sections, mixed units, a per-line discount, and one row whose tax column is genuinely blank. Complete hand-checked ground truth |
| `invoice-services` | A second, completely different invoice layout — the reason a fallback chain exists |
| 9 more invoices | AWS, Flipkart, QualityHosting, Netpresse, free_fiber, OYO, Saeco, and Coolblue twice. **Nothing here can parse these**, which is what makes example 06 real |
| `invoice-orlen` | An invoice that is already **text**. `DocumentLoaderData` with no PDF library involved |
| `scan-services`, `scan-aws` | Full-page rasters, 1700×2200 and 2975×3850. **No text layer, real glyphs** — and `scan-services` pairs with a PDF we also have, so OCR and the text layer can be scored against the same truth |
| `statement` | Six pages holding **two** accounts plus a blank form on page 6. A real bundle, and a real unclassified page |

Sources: [invoice2data](https://github.com/invoice-x/invoice2data/tree/master/tests/compare),
which publishes ground truth beside each sample, and
[Carson Bank](https://www.carsonbank.com)'s own specimen statement. None contain real
personal data — the statement is made out to "JOHN TEST", the Odoo invoice is demo data,
and the Sammy Maystone invoice says so on its own last line.

Adding one: append to `DOCUMENTS`, then `DOCTURE_RECORD=1 pnpm run fetch` prints the manifest
entry with the real measured numbers, rather than you guessing them.

### Two honest limitations

- **Nothing in the corpus is a true scan.** The two PNGs are clean renders — no skew, no
  sensor noise, no JPEG artifacts. They are an honest "no text layer" case and an easy OCR
  case. Finding a licence-clear, stably-hosted real scan is open work.
- **Published truth is not a clean answer key.** invoice2data's line-item schema varies by
  template and does not agree with ours about what a line item's *description* is, so
  example 12 scores five scalar fields against it and scores line items against
  hand-checked truth instead. [The details](shared/truth/published.ts) are worth reading
  before you trust any eval harness, including your own.

## Feature coverage

The tour covers the following public APIs. Imports use `docture` and its exported
subpaths; `@docture/cli` is the separate command-line package.

| Surface | Example |
|---|---|
| `Extractor`, `createExtractor`, `extract`/`extractData`/`extractResult`, `ExtractionResult`, `Attempt`, `Usage`, `dispose` | 01, 06, 13 |
| `contract` family, `resolveSchema`, `FlexibleSchema`/`InferSchema`, `ValidationOutcome` | 02 |
| `DocumentLoaderPdfJs`/`MuPdf`/`Data`, `DocumentSource`, `resolveSource`, `sniffMimeType`, `DocumentFeatures`, `inferForm`, `loaderAccepts` | 03 |
| `LoaderCapabilities`, `withRasterizer`, `Rasterizer`, `RasterOptions`, both rasterizers, `hasFact` | 04 |
| `defineStrategy`, `defineLoader`, `defineRasterizer`, `linesFromWords`, `textFromLines`, `imageSize` | 05 |
| `RoutingPolicy`, `declarationOrder`, `only`, all fourteen `DoctureError`s, `errorCodeOf`, `isAbortError`, `Logger` | 06 |
| `LLM`, `llm`, `LlmStrategy`, `createLlmExtractor`, prompt exports, cache exports, pricing exports | 07 |
| `CompletionStrategy`, `chunkByPage`, `chunkByBudget`, `estimateTokens`, `mergePartials`, `relaxJsonSchema` | 08 |
| `VisionStrategy`, `DocumentLoaderTesseract`, `DocumentLoaderPaddleOcr`, `PADDLE_MODELS` | 09 |
| all `Classification*`, `defineClassifier`, `LlmClassifier`, `ClassificationStrategy`, tree exports | 10 |
| `Process`, `defineSplitter`, `runSplitter`, `TextSplitter`, `ImageSplitter`, `SplittingStrategy`, `DocGroups`, `pageWindows`, `aggregateDocGroups`, `UNCLASSIFIED` | 11 |
| `docture/eval`, `extractBatch`, `BatchItem`/`BatchOptions`, `safeExtract` | 12 |
| `runPipeline`, `loadDocument`, `PipelineComponents`, `preloadedFeatures`, `isLoadedSource`, `components` | 13 |
| `docture/testing/doubles`, `docture/testing/fixtures`, `docture/testing/conformance`, `MockLanguageModelV4` | 14 |
| `@docture/cli` | 15 |
| `DocumentConverter`, conversion types, layout types, rich conversion fixture | 16 |

## Tests

```sh
pnpm --filter @docture/examples test
```

Two files, and they run for different reasons.

[`test/examples.test.ts`](test/examples.test.ts) asserts the **arithmetic and the
routing** of the examples themselves — line items sum to the subtotal, the statement
reconciles, no row carries both a debit and a credit, the Odoo invoice scores F1 1.0, an
absent tax column is `null` and not `0`, and each document routes to the strategy it
should. It imports the contracts, parsers, classifiers and splitters **from the example
files**, so it checks the code you read rather than a copy of it. The parts that need a
downloaded document skip when `documents/` is empty.

[`14-testing-your-pipeline/pipeline.test.ts`](14-testing-your-pipeline/pipeline.test.ts) is
itself the example, and needs nothing at all.

`pnpm typecheck` matters here too: examples 02 and 04 assert things that are only checked
at compile time, including four `@ts-expect-error` lines that fail the build if the library
ever *stops* rejecting a bad wiring.
