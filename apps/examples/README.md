# @docture/examples

A browsable tour of the library, one folder per concept, on **real documents**.

```sh
pnpm --filter @docture/examples fetch      # ~2 MB, once
pnpm --filter @docture/examples quick-start
```

Ten of the sixteen need no API key at all, and two more run most of the way without one.
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
| 06 | [fallback-routing-and-errors](06-fallback-routing-and-errors) | eleven layouts, two parsers, eleven typed errors, timeouts | — |
| 07 | [with-a-model](07-with-a-model) | the AI SDK seam, prompts, caching, cost | key |
| 08 | [long-documents](08-long-documents) | completion strategies, chunking, merging | key¹ |
| 09 | [scanned-and-ocr](09-scanned-and-ocr) | no text layer, OCR as a loader, vision | key / `RUN_OCR=1`¹ |
| 10 | [classification](10-classification) | narrowing, custom + LLM classifiers, consensus, trees | key¹ |
| 11 | [bundles-and-splitting](11-bundles-and-splitting) | `Process`, splitters, unclassified pages, split cost | key¹ |
| 12 | [accuracy-and-batch](12-accuracy-and-batch) | scoring, the truth-completeness trap, `extractBatch` | — |
| 13 | [under-the-hood](13-under-the-hood) | config-driven wiring, read-once, `runPipeline` | — |
| 14 | [testing-your-pipeline](14-testing-your-pipeline) | doubles, fixtures, conformance, mocking a model | — |
| 15 | [cli](15-cli) | `inspect`, `extract`, `classify`, `eval`, a config file | —² |
| 16 | [document-conversion](16-document-conversion) | `DocumentConverter`, TXT/Markdown/HTML, assets, provenance | — |

¹ Part of the example runs without a key; the rest says what it would have done and skips.
² `extract` and `classify` work keyless through the config file in that folder.

```sh
pnpm --filter @docture/examples offline   # the eleven that run without a key
pnpm --filter @docture/examples all       # everything; skips loudly where a key is missing
pnpm --filter @docture/examples test      # 41 tests, ~1s
```

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

`pnpm fetch` verifies every arrival against the manifest in
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

Adding one: append to `DOCUMENTS`, then `DOCTURE_RECORD=1 pnpm fetch` prints the manifest
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

Every export in the public `index.ts` files appears in exactly one example. If you find a
gap, it is a gap.

| Surface | Example |
|---|---|
| `Extractor`, `createExtractor`, `extract`/`extractData`/`extractResult`, `ExtractionResult`, `Attempt`, `Usage`, `dispose` | 01, 06, 13 |
| `contract` family, `resolveSchema`, `FlexibleSchema`/`InferSchema`, `ValidationOutcome` | 02 |
| `DocumentLoaderPdfJs`/`MuPdf`/`Data`, `DocumentSource`, `resolveSource`, `sniffMimeType`, `DocumentFeatures`, `inferForm`, `loaderAccepts` | 03 |
| `LoaderCapabilities`, `withRasterizer`, `Rasterizer`, `RasterOptions`, both rasterizers, `hasFact` | 04 |
| `defineStrategy`, `defineLoader`, `defineRasterizer`, `linesFromWords`, `textFromLines`, `imageSize` | 05 |
| `RoutingPolicy`, `declarationOrder`, `only`, all eleven `DoctureError`s, `errorCodeOf`, `isAbortError`, `Logger` | 06 |
| `LLM`, `llm`, `LlmStrategy`, `createLlmExtractor`, prompt exports, cache exports, pricing exports | 07 |
| `CompletionStrategy`, `chunkByPage`, `chunkByBudget`, `estimateTokens`, `mergePartials`, `relaxJsonSchema` | 08 |
| `VisionStrategy`, `DocumentLoaderTesseract`, `DocumentLoaderPaddleOcr`, `PADDLE_MODELS` | 09 |
| all `Classification*`, `defineClassifier`, `LlmClassifier`, `ClassificationStrategy`, tree exports | 10 |
| `Process`, `defineSplitter`, `runSplitter`, `TextSplitter`, `ImageSplitter`, `SplittingStrategy`, `DocGroups`, `pageWindows`, `aggregateDocGroups`, `UNCLASSIFIED` | 11 |
| all `@docture/eval`, `extractBatch`, `BatchItem`/`BatchOptions`, `safeExtract` | 12 |
| `runPipeline`, `loadDocument`, `PipelineComponents`, `preloadedFeatures`, `isLoadedSource`, `components` | 13 |
| all `@docture/testing`, `MockLanguageModelV4` | 14 |
| `@docture/cli` | 15 |
| `DocumentConverter`, conversion types, layout types, `LlmLayoutAnalyzer`, rich conversion fixture | 16 |

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
