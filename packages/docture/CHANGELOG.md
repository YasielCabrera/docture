# docture

## 0.3.0

### Minor Changes

- 19f9cff: Breaking change: Attempt records now require a stage. Failed model and validation attempts retain validation issues, finish reasons and raw response text capped at 10,000 JavaScript characters.
- 19f9cff: Choose Tesseract's default concurrency from available CPUs, leaving one CPU free and capping the pool at four workers. Explicit concurrency settings continue to win. Each worker can use about 100 MB, so set concurrency to 1 in memory-constrained hosts.
- 19f9cff: Default vision rendering to a 1568-pixel maximum edge and send together-mode pages in groups of at most 20. Configure pagesPerRequest to adjust the group limit. Include render and grouping settings in cache identity.
- a5ddf09: Include the provider and resolved temperature in LLM response cache keys for extraction, vision, classification, layout, and splitting. String models use the gateway provider, and an unset temperature shares entries with zero.

  `CacheKeyParts` now requires `provider` and `temperature`. This changes persisted cache digests. Old entries are no longer reused, and the first matching request calls the model again. File-cache entries remain on disk.

- dad34aa: Add `timeoutMs`, a deadline for a whole call, to extraction and classification options, `ConvertOptions`, `Process.extract()` and `splitOnly()`, and as a default on `Extractor` and `DocumentConverter`. When it passes, every component's signal aborts and the call rejects with `TIMEOUT` at stage `"call"`, even when a component ignores its signal. The layout analyzer stage deadline now abandons an analyzer that ignores its signal. The CLI `--timeout` flag is now this per-document deadline, applied with each call so it also bounds an extractor or converter the config supplies already built. `review --timeout` covers the document's conversion or extraction and its page rendering together, and the service's `flags.timeoutMs` bounds each request's whole call. Set `stageTimeoutMs` in `docture.config.ts` for a per-stage deadline.

  The public `runPipeline()` function also enforces `timeoutMs`. Deadlines keep standalone Node calls alive until they settle and reject late splitter results. `review --timeout` includes reading source bytes. CLI commands validate the flag before configuration or resource setup, including dry runs.

  A `timeoutMs` or `stageTimeoutMs` above 2147483647 ms, the longest delay `setTimeout` accepts, sets no timer, including in `review`. Before, the runtime clamped it to 1 ms and the stage or call timed out at once.

- 19f9cff: Breaking change. Export one class and matching Options type per loader: DocumentLoaderPdfJs, DocumentLoaderMuPdf, DocumentLoaderTesseract, and DocumentLoaderPaddleOcr. Remove the former class aliases and Config aliases. Constructor names now match the public class names.
- 9fc9b6a: Report `minOcrConfidence` on field citations: the lowest OCR span confidence behind a verified match, or across the cited lines of a cited-unverified value. It is absent unless every relevant span has a score and each cited line's text is its spans joined by single spaces. `docture review` shows it beside each field.
- 9fc9b6a: Conflict, citation and schema issue paths now quote a key that is empty or contains a dot or a backtick, so the literal key `"a.b"` (`` `a.b` ``) no longer collides with the nested field `a.b`. A single part with both no longer reports a false conflict. `formatFieldPath` and `parseFieldPath` write and read the path text. The CLI review page matches citations by the same paths.
- 19f9cff: Run text chunks and vision page groups with a default concurrency of four. Preserve input-order results, stop scheduling new work after failure, and abort and drain active requests. Export mapWithConcurrency for bounded, ordered work with cancellation.

  Preserve completed usage when sibling transport, render, or cache work fails, while keeping the original provider error. Strategies can report known failure usage through the optional StrategyContext.reportFailureUsage callback.

- 9fc9b6a: `docture/testing/conformance` accepts fixture profiles. `describeLoaderConformance` and `describeRasterizerConformance` take `fixtures`, with `pdfFixtures` as the default and `textFixtures` and `pngFixtures` shipped, or a custom `ConformanceFixtures` profile. Checks a profile cannot express, such as page size for text, are reported as skipped. `describeRasterizerConformance` takes `format` to check an advertised output format other than PNG. `DocumentLoaderData` now rejects an already aborted load, and passes the loader suite with `textFixtures`.
- b709d9e: Consolidate the library into `docture` with explicit ESM subpaths and retain the separate `@docture/cli` package. The root now exports core APIs only. Import model APIs from `docture/llm` or a narrow entry such as `docture/llm/text`. Replace scoped loader, rasterizer, eval and testing imports with the documented `docture/...` paths.

  Engine dependencies are optional peers and must be installed explicitly for the selected integration. PDF.js, canvas, MuPDF and PDFKit accept ranges (`^6.2.108`, `^1.0.10`, `~1.28.0` and `>=0.17.2 <0.21.0`); Tesseract.js, PaddleOCR and ONNX Runtime stay at exact versions. An application that already depends on another release of an OCR engine needs the npm override in the installation guide to install `docture` for core use. The canvas rasterizer draws on the canvas that PDF.js loads, so pages render when a package manager installs a separate canvas for PDF.js. Model integrations accept Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later. An adapter whose engine is not installed throws the new `MissingEngineError` (`MISSING_ENGINE`) with the package and range to install; the CLI prints an install hint instead of calling the file damaged. Error classes recognize instances from another installed copy of `docture`, so usage, codes and fallback survive when pnpm installs separate copies for an application and the CLI. A typed CLI config accepts an `extractor` or `converter` built by either copy. The CLI retains AI SDK and PDF.js dependencies and its optional native canvas installation. Testing doubles, fixtures and conformance suites have separate entry points. Fixtures need PDFKit; conformance suites need Vitest and use those PDFKit fixtures.

  This changes existing imports and dependency installation. See the migration guide before upgrading. All wrappers ship in the library tarball. Production bundlers can prune unused ESM modules; convenience classes retain their referenced capabilities.

- 9fc9b6a: Converted element IDs now come from each element's content and position instead of its order on the page. An ID is `p<page>-` followed by 12 hex characters of a SHA-256 digest over the identity class, the page, the rounded left and top position, and the normalized content, so inserting an unrelated element no longer renames later elements or the chunks built from them. Page breaks keep `p<page>-page-break`, exact duplicates get `-2`, `-3`, and so on, and `sourceIds` and `lineIds` keep their loader and canonical line IDs.

  This changes every ID that conversion produces. Old ordinal IDs such as `p1-text-4` are not mapped to the new scheme: convert the source again to get the new IDs, and update layout analyzers or tests that hard-coded ordinal element IDs to read IDs from `ctx.document`. Saved JSON documents with ordinal IDs still parse unchanged.

- 9fc9b6a: Add `examples` to contracts and classifications: worked text-to-data pairs typed by the schema, checked against it when an extraction starts, and sent with every text and vision extraction prompt, including repairs. A changed example gets its own cache entry.
- 9fc9b6a: `convert`, `safeConvert`, and `convertBatch` accept `pages`, a list of original one-based page numbers. The converter copies the list when the call starts, asks the loader for only those pages, and keeps only those pages for preloaded sources and loaders that ignore the hint. Text, Markdown, HTML, and JSON results, features, and assets cover the selected pages and keep their original page numbers, and tables and paragraphs join only across consecutive original pages. An empty selection or a missing page throws `PageSelectionError` (`PAGE_OUT_OF_RANGE`), as extraction does.

  The MCP `convert` tool accepts the same `pages` argument. Malformed pages are invalid parameters, and a page the document lacks fails the item with `PAGE_OUT_OF_RANGE`.

- 9fc9b6a: Add `checkConversion` to `@docture/eval/conversion`. It grades converted output with presence, absence, order, and table-neighbour checks, each with a stable id and a literal failure reason. Page, provenance, and merged-cell checks read the converted document; text checks also accept Markdown or plain text. `docture/testing/fixtures` adds `conversionCorpus`, loaded documents for known layout cases with the checks each should pass.
- 3494ca0: Make OCR reachable when converting scans.

  - `DocumentConverter` tries the next eligible loader when a loader recovers no text from the selected pages, so an OCR loader listed after PDF.js reads a scanned PDF. The skipped loader appears in `attempts` with status `"skipped"`. Extraction keeps its current loader routing.
  - `NoConvertibleContentError` now says how to OCR a scan, and names `withOcrFallback` for mixed documents.
  - `withOcrFallback(primary, ocr)` no longer needs options. Pages with fewer than 20 characters of trimmed text go to OCR. The defaults are exported as `textLengthQuality` and `DEFAULT_OCR_THRESHOLD`.
  - `ConversionResult.ocrFallback` reports which pages `withOcrFallback` sent to OCR, which loader supplied each page, and per-page OCR warnings. The versioned JSON output is unchanged.
  - A disposed `DocumentConverter` rejects new conversions with `DisposedError` (`DISPOSED`), and a conversion in flight stops before it starts another loader or OCR page. Before, converting after `dispose()` started a new OCR worker pool that nothing released.
  - `docture convert --ocr tesseract|paddleocr` rereads pages with too little text using that engine. A missing engine fails with its install command instead of an empty result.

- 3494ca0: Import real docling-serve 1.38.2 responses. The Docling importer reads list-item charspans from `orig`, accepts the space or removed hyphen that docling leaves between joined text boxes, and keeps the text of overlapping table cells with an `OVERLAPPING_TABLE_CELLS` diagnostic. The default `limits.maxNodes` rises from 100,000 to 2,500,000, and every limit error names the limit, its value, and the option that raises it. Async Docling jobs no longer count queue time against `jobTimeoutMs`: the new `queueTimeoutMs` bounds queued time, and `maxPolls` now defaults to cover both deadlines. `DoclingServeClient.health()` checks docling-serve's `/health` route before a batch.
- b709d9e: Report optional `cacheReadTokens` and `cacheWriteTokens`, and price provider cache reads and writes at configured rates. Missing cache rates use the input rate. Export `sumUsage` to combine usage with the same rules across extraction, splitting, and conversion.

  Include classifier calls and schema-failed model calls in reported usage. Classifier options now accept `pricing` and `instructions`. `ModelOutputError` carries `MODEL_OUTPUT_FAILED`, the SDK cause, and available usage. Failed extraction attempts retain this usage through fallback.

  Direct strategy, layout-analyzer, and splitter calls now throw `ModelOutputError` for schema failures. Code that checked `NoObjectGeneratedError.isInstance(error)` must inspect `error.cause` instead. Configured shared instructions now reach the classifier prompt, which can change its verdicts and makes classifier cache entries created without those instructions unreachable.

  Share cache, pricing, temperature, retries, and instructions with vision and classification in `createLlmExtractor`. CLI classification shares its available model options and cache with the strategies.

- dad34aa: Give every `DoctureError` a `hint` naming the next step, serialize every diagnostic field and cause in `toJSON()`, and let `isDoctureError(error, code)` narrow to that code's error class. For a core code the check matches only an instance of that class, from any installed copy, so the narrowed fields exist at runtime: an error that copies its cause's code, such as eval's priced failure, does not match, while `errorCodeOf` still returns the copied code. `LOAD_FAILED` narrows to `LoadFailedError` with `attempts` always present. `PaperlessError` and `DoclingImportError` now extend `UnsupportedSourceError`, so they match `"UNSUPPORTED_SOURCE"`. `errorCodeOf` now returns the `DoctureErrorCode` union, and `isCallerAbort(error, signal)` tells a caller's cancel from a component's own timeout. The serialized fields can include `rawOutput` and validation `issues`, which may hold document text; redact them before shipping errors to an external log.

  `DoclingServeError`, `MammothDocumentError` and `EmailInputError` now carry their own codes, `DOCLING_FAILED`, `DOCX_FAILED` and `EMAIL_INVALID`, each with a hint. Inside a pipeline they appear as a loader attempt's `errorCode`.

- ad9cc23: Publish @docture/eval with schema-driven evaluation, project-defined datasets, versioned results, comparison, gates, reporters, calibration, grounding, framework adapters and an optional LLM judge. Replace docture/eval with the new package, move conversion checks to @docture/eval/conversion, and add the docture eval subcommands and stable eval error identities.
- dad34aa: Invalid options now raise `InvalidOptionError` with code `INVALID_OPTION` instead of `RangeError` or `TypeError`. It carries `option`, `expected` and `received`, and its hint names the accepted values. This covers `concurrency`, `maxRepairs`, `onRuleFailure`, `pagesPerRequest`, `maxEagerPages`, `maxPixels`, chunk budgets, OCR fallback thresholds, `pageWindows` sizes, email limits and empty Tesseract `languages`, which is now rejected when the loader is built. The CLI exits with code 2 for it.
- 9fc9b6a: `page.image()` accepts a per-call signal as its second argument, `{ signal }`. An aborted call rejects with the signal's reason and cancels its render once no other caller waits for it; a cancelled render is not memoized. The vision strategy and `ImageSplitter` pass their signal, the OCR loaders honour it, and `NapiCanvasRasterizer` cancels the active PDF.js render task on abort. `docture review` and `docture inspect --render` stop rendering when the command is cancelled, and inspect reports the cancellation instead of a render error.
- 16239e2: **Breaking (0.x):** conversion JSON is now `schemaVersion: 2`, described by the new `docture-document-v2.schema.json`. The published version 1 schema is frozen and unchanged. Version 2 adds the `page-header` and `page-footer` element kinds, an optional `lineIds` list of canonical `p<page>-line-<n>` IDs on each provenance segment, `TableElement.spans` for merged cells, `ElementProvenance.continuations` for a table or paragraph that continues onto later pages, and `TableElement.rowProvenance` with one segment per row. `ConvertedPage.content` holds every element that starts on the page, including the part of it on later pages. `DocumentElement` gains the two furniture kinds, so an exhaustive `switch` over `element.kind` needs two new cases, and `LayoutElementRole` excludes them. New exports: `parseDoctureDocument()` validates saved version 1 or version 2 JSON and returns a version 2 document with dotted-path issues; `sourceLines()` and `isLineSourceId()` enumerate and recognise canonical line IDs; and the types `ProvenanceSegment`, `SourceLine`, `LineSourceId`, `PageHeaderElement`, `PageFooterElement`, `FurnitureEvidence` and `DoctureDocumentParse`.
- 16239e2: Add the `docture/chunk` entry with `chunkDocument()`, which splits a conversion result or a saved JSON document into retrieval chunks of whole elements. Each `DocumentChunk` has a stable `id`, Markdown `text`, `elementIds`, and the `provenance` segments (page, box, source and line IDs) of its elements. The budget counts characters or estimated tokens (`estimateTokens()`, `ceil(characters / 4)`) and is soft in one case only: a chunk exceeds it when it holds a single element, or one table row group with its header rows, that is larger than the budget with its heading path. Headings start new chunks, and `headingPath: true` prefixes the headings above each chunk. A table larger than the budget splits between rows, keeps row-span groups together, repeats its header rows in every piece, and cites only its rows' pages. Body text is never repeated unless `overlapElements` asks for it, and a repeat that would exceed the budget is dropped.
- 16239e2: Opt-in field citations for text extraction. `llm({ model, citations: true })`, `createLlmExtractor({ llm: { citations: true } })` and `new LLM(model, { extraction: { citations: true } })` show the document to the model as lines with canonical `p<page>-line-<n>` IDs and ask for `{ data, citations }`. Each present leaf of `result.data` then gets one `FieldCitation` in `result.citations`: `verified` when the value was found in the cited lines (with `ids` narrowed to exactly the lines the match spans), `cited-unverified` when the lines exist but do not show the value, or the caller's schema changed it, and `uncited` otherwise. `result.citationSources` lists the cited `SourceLine`s with their boxes. Verification is exact: strings after NFKC and whitespace collapsing, numbers after currency, grouping and parentheses, and ISO dates against unambiguous printed dates only, so `05/03/2024` stays `cited-unverified`. An ID the request never showed is not evidence. Array indexes are rebased across `paginate` and `concatenate` merges, caller refinements and transforms still run, and a cached answer is validated and verified again on every hit. Citations add prompt and output tokens, and long tables can make an answer truncate. Vision extraction and documents without positioned lines are never cited, and with citations off every request is unchanged. New types: `FieldCitation`, `CitationStatus`, and, for custom strategies, `OutcomeCitation` on `StrategyOutcome.citations` and the `data` variant of `RepairInput`.

  `docture extract --citations --full` adds `citations` and `citationSources` to each result record, and `--full` now also adds `validation` and, when present, `conflicts`. `--citations` without `--full` is a usage error, and it warns when config strategies replace the model's.

- 16239e2: Tag every model call for AI SDK telemetry. Text and vision extraction, classification, layout analysis, both splitters, and repairs now pass `telemetry` to the AI SDK with a fixed `functionId` (`docture.<stage>.<component>`, for example `docture.extract.llm`) and a `docture` runtime-context entry naming the source file, pages, and chunk. `recordInputs` and `recordOutputs` default to `false` for docture's calls, which changes the AI SDK default when a global integration is registered. They are flags that integrations honour, not filters: the AI SDK still passes prompts and answers to each integration's callbacks, so check that every integration you register honours them. Configure it with `telemetry: LlmTelemetryOptions` on each component or once on `LLM`; `documentLabel: false` keeps file names out. `StrategyContext`, `ClassifyContext`, and `SplitContext` gain an optional `documentLabel`.
- 16239e2: Read single- and multi-page TIFF with `DocumentLoaderPaddleOcr`. Install the new optional peer `utif2@4.1.0`; the loader imports it only for TIFF input and reports `MISSING_ENGINE` when it is absent. Each selected page is decoded to PNG before the engine sees it, so TIFF bytes never reach the native image decoder, and `page.image()` returns that PNG. Classic TIFF in either byte order is supported with no compression, LZW, Deflate, PackBits, or CCITT Group 3 or Group 4, up to 8192 x 8192 pixels per page. Malformed TIFF, other compressions, and larger pages reject before decoding or recognition, as do layouts that would make the decoder allocate more than the page needs, such as a tile far larger than its page. Decoding writes nothing to stdout. Pages decode one at a time with abort checks between them, the decoder never follows sub-IFD, Exif, or GPS links, and TIFF bytes labelled PNG or JPEG are read as TIFF.
- 16239e2: Join tables and paragraphs that continue across a page break. A table that ends in the bottom quarter of a page and continues at the top of the next page, in the same columns, cell count, font size, and weight, becomes one table on its starting page. A column whose cells are numbers rejects continuation rows with letters in it, and every continued row must start within three row spacings of the row above. A copy of its header row at the top of the next page is dropped from `rows` and kept in `sourceText`, and a two-row fragment that column detection would split is joined too. A paragraph that does not end with terminal punctuation, in the bottom quarter of its page, joins a next page that starts with a lowercase letter in its top quarter. The joined element records each later page in `ElementProvenance.continuations`, read with the new `provenanceSegments()`, and every detected table records `TableElement.rowProvenance`, one segment per row. Each page's content holds the elements that start on it, so the next page marker follows the joined body. A layout analyzer cannot retype, group, or move a joined element away from the end of its page's text. `parseDoctureDocument()` rejects continuations that skip pages or sit on other element kinds, and row provenance that does not match the rows.
- 16239e2: Detect running headers and footers. Conversion marks lines that repeat in the top or bottom 10% of at least three pages, and tagged `header` and `footer` hints inside those bands, as `page-header` and `page-footer` elements. Page numbers that follow the page, such as `Page 2 of 9`, match across pages, and odd-page and even-page running heads are detected separately. Markdown and HTML leave them out of the body; TXT and JSON keep them. Layout analyzers no longer see them, and annotations that name them are ignored. `ConvertedPage` now reports the page `width` and `height`. The thresholds are heuristics and are documented in the core conversion reference.
- 16239e2: Breaking change: rename `loadDocument` to `readDocument`. The parameters and return type are unchanged, and no `loadDocument` alias remains. Replace `loadDocument(loaders, raw, logger, signal, stageTimeoutMs)` with `readDocument(loaders, raw, logger, signal, stageTimeoutMs)`. The `load*` prefix now only names builder registration methods such as `loadDocumentLoader`.
- 16239e2: Report conflicting scalar values. When the requests of a multi-request extraction (text `paginate` or `concatenate`, or vision with several page groups) return different present values for the same scalar, the first value still wins and `result.conflicts` lists each disagreeing path with every value and the pages that gave it. A path where one part gave a scalar and another an object or array is a conflict too. The field is omitted when the parts agree, and a repaired answer keeps the conflicts of the extraction it replaced. Strings compare after trimming and numbers by value; array rows are never compared. `ConflictingValue.value` is a scalar, or the object or array that met one. `StrategyOutcome.conflicts` carries the list from a custom strategy. `docture/llm/merge` adds `mergePartialsWithDiagnostics(parts)`; `mergePartials` and its zero/false presence rule are unchanged.
- 16239e2: Repeat a continuing table's header in multi-request text extraction. Under `paginate` and `concatenate`, a request that starts on a page whose rows continue a table from an earlier page now begins with `Table header continued from page N:`, the flattened header row, and a line marking it as context. The header comes from the conversion table analysis over positioned lines, counts against `maxCharsPerRequest`, carries no citation line ids, and is part of the response cache key. Documents without positioned lines and `forbidden` requests are sent unchanged. `chunkByPage` and `chunkByBudget` accept an optional `ChunkContext` function for the same purpose.
- 16239e2: Detect merged table cells and multi-row headers. When table rows differ in cell count, the rows with the most cells set the column bands, and shorter rows join the table when each cell falls in a band, so totals and sparse rows stay in their table. A label that covers more than half of each of several empty columns becomes a merged cell in the new `TableElement.spans` (`TableCellSpan`), and `headerRows` counts the header rows such a label proves. HTML writes `colspan` and `rowspan`. Markdown flattens header rows into one row, as in `| Item | Quarters / Q1 | Quarters / Q2 |`, and leaves covered body cells blank. TXT keeps the source lines. Row spans need a cell box that covers each spanned row line, which OCR or synthetic geometry can provide; an empty cell never makes one. Tables whose rows all have the same cell count convert as before, except that a row starting more than three row spacings below the row above, such as a page footer, no longer joins the table. `parseDoctureDocument()` rejects saved tables whose spans overlap, leave the grid, cross the header rows, or cover non-empty cells, and a layout analyzer group that would produce such a table is ignored.
- 16239e2: Read single- and multi-page TIFF with `DocumentLoaderTesseract`. Each image file directory becomes one page in file order, and `maxPages` and requested pages apply before recognition. Classic TIFF in either byte order is supported with no compression, LZW, PackBits, or CCITT Group 3 or Group 4, up to 8192 x 8192 pixels per page. Malformed TIFF, other compressions, such as Deflate, and larger pages reject before recognition, including TIFF bytes labelled PNG or JPEG. `page.image()` on a TIFF page returns PNG. `imageSize()` now sizes TIFF, and the new `tiffPages()` export lists the pages of a classic TIFF. It rejects files whose IFDs overlap, and pages whose layout would make a decoder allocate far more than the page needs: more than 64 bits per pixel, zero rows per strip, tiles that leave pixels uncovered or exceed both the page and 1024 x 1024 pixels, and camera-raw layouts.
- 16239e2: Repair invalid answers. When a strategy's answer fails the schema, or a validation rule in `"fail"` mode, the pipeline now asks the strategy again with its previous answer and the issues before trying the next strategy. `LlmStrategy` and `VisionStrategy` implement the new optional `ExtractionStrategy.repair(ctx, previous)`. This changes default behavior and cost: one repair per strategy is on by default (`maxRepairs: 1`), so an invalid model answer now costs one more billed request before fallback. Set `maxRepairs: 0` on the extractor or the call to keep one request per strategy. Each repair is recorded as an attempt with `stage: "repair"` and its usage is included in `result.usage`. `maxRetries` still only retries failed transport requests. Report-mode rule issues never trigger a repair.
- 16239e2: Add validation rules. Pass `rules` to `createExtractor()` or to a single extraction to check facts a schema cannot express, such as line amounts adding up to the subtotal. Per-call rules are typed from the contract and replace the extractor's rules; an empty array clears them. Rules report by default: `result.validation` now carries `valid: false` and the rule issues instead of a constant `{ valid: true, issues: [] }`. `onRuleFailure: "fail"` fails the attempt with `CONTRACT_VIOLATION` and tries the next strategy. A rule that throws rejects the extraction. `RunOptions` and `BatchOptions` gain a type parameter for the contract data, defaulting to `unknown`.
- dad34aa: Add `onEvent` to extraction options and `ConvertOptions`. It receives `PipelineEvent` objects as they happen: `load`, `classify`, each finished `attempt` (the same object the result lists), and a `page` event per analyzed page during conversion. A listener that throws, or returns a promise that rejects, is logged and ignored. The pipeline does not wait for a returned promise.
- ea4b757: Make the core and chunk entries portable and move local file defaults to docture/node. Add checked construction, extraction tools, descriptive calibration reports, Docling native evidence and service conversion, Paperless sources and fill-empty write-back, DOCX/EML inputs, and explicit page OCR fallback.

  Add warm localhost HTTP service operations and configured Paperless CLI/MCP extraction and plan/apply. Preserve native element/cell evidence through saved JSON, chunks and review. Correct shared resource disposal, batch concurrency, HTTP source failures and OCR render caps. Ship installed consumer guides and container build/smoke recipes.

- dad34aa: Breaking change: `Process.dispose()` no longer disposes the extractor passed to `loadExtractor()`. The process borrows it, so dispose the extractor through its owner. `Process` also supports `await using`.
- dad34aa: `Process.extract()` and `Process.splitOnly()` accept a source as their first argument, so one configured process can run several files concurrently. `loadFile()` still sets the default source.
- 19f9cff: Pass requested page numbers to loaders before parsing and OCR. Built-in adapters read only the selected pages and preserve original numbering. Custom loaders may ignore the optional hint, with pipeline projection preserving correctness.

  Breaking change for custom rasterizers that return sparse pages. OCR maxPages caps original page numbers rather than the number of returned rasters.

- 9fc9b6a: Describe a fail-mode validation rule failure as a rule failure rather than a schema failure. `ContractViolationError` gains `failedCheck` (`"schema"` or `"rule"`), its message names the failed check, and the CLI gives a rule failure its own recovery hint.
- 5536666: Publish @docture/synthetic. It generates labeled synthetic documents from an extraction schema, with seeded models, generators, constraints, scenarios, printed masks and typed templates. Each label records the field's value, page and box. Optional entries render with PDFKit or Chromium, verify labels through PDF.js, measure how far a template's text drifts from a reference PDF, add scan, photo and fax degradations with sharp, generate locale-aware values with Faker, build cached text pools with an AI SDK model, and write corpora that @docture/eval reads.

  @docture/eval now reads expected field locations from the `locations` field of `jsonlDataset` rows and from a `locations.json` file in each `folderDataset` case. Docture adds the error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID` and `LABEL_VERIFICATION_FAILED`.

- 9fc9b6a: Model-call telemetry now names what each call actually covered. Layout analysis calls carry the source file name as `document`, honoring `documentLabel: false`, and `LayoutAnalyzerContext` gains an optional `documentLabel`. A classifier call lists only the pages with text in the excerpt it sent, with their original page numbers, and has no `pages` when a preloaded document's text cannot be traced to its pages.
- 19f9cff: Breaking change. Missing pipeline components and invalid call order now throw MissingComponentError with code MISSING_COMPONENT instead of TypeError. Export isDoctureError for installed-copy identity checks. Serialize DoctureError with its code, name, message, hint, own diagnostic fields and cause.
- 19f9cff: Export conversion layout as versioned JSON with original element IDs, provenance, final warnings, and referenced, embedded, or omitted assets. Add the json document format to docture convert --to.
- 3494ca0: Convert scanned PDFs to Markdown with a vision model. `llmOcr()` from `docture/llm/ocr` renders each page with a rasterizer and asks an AI SDK model for its headings, paragraphs, lists, tables, and code, which conversion exports as they are. It works on its own or as the OCR loader of `withOcrFallback`. A page whose answer does not fit the layout schema fails with `MODEL_OUTPUT_FAILED` naming the page.

  Test model layout and model OCR without a provider. `docture/testing/llm` exports `mockLayoutModel()` and `mockOcrModel()`, which answer with the annotations or page elements you give. The entry has no runtime imports, so `docture/testing/doubles` still needs no model packages.

### Patch Changes

- dad34aa: A loader, classifier, or strategy that ignores its abort signal no longer holds the pipeline past its stage deadline. The pipeline records a `TIMEOUT` attempt, moves to the next component, and leaves the late call to settle. After a caller abort, the pipeline still waits for the call to settle.
- 19f9cff: Support await using for extractors, document converters, composed loaders, and disposable OCR loaders.
- a5ddf09: Abort and await in-flight extraction and conversion jobs when a batch consumer exits early. The caller's abort signal remains connected. A job that ignores cancellation delays the generator's return until it settles.

  Preserve inherited, getter-based and non-enumerable extraction and conversion options when attaching batch cancellation.

- dad34aa: Weigh bold and monospace type by characters, so a bold lead-in such as `Coverage.` stays inside its paragraph instead of becoming a heading. A bold line at body size is a heading only when every run is bold, and bold table rows, amounts such as `Total due ₹17,348.36` or `Balance: 980.00`, rules, and lines without letters stay out of the outline. A bold version or section number such as `Version 3.11` is still a heading.
- 49d0324: Ship the complete offline Markdown documentation once in `docture`, generated on build and pack. Expose `docture/docs/manifest.json` for discovery with exact documented package versions and content hashes. Point each package's agent guide to the installed snapshot and reject unreleased documentation during publication.
- a5ddf09: Copy responses on memory cache reads and writes so mutating an extraction result cannot alter future cached answers.
- 19f9cff: Preserve custom caller cancellation reasons across loading, classification, extraction and conversion, including already-cancelled preloaded conversion. Reject late stage results after their deadlines while retaining known billed usage exactly once.
- 9fc9b6a: Conversion now merges a bold group label centred over two or more table columns, such as `Quarters` above `Q1` and `Q2`, into a header cell with `colSpan`, even when the label overlaps neither column, and counts the row below it as a second header row. The label needs a bold header row under rows that are not all bold, at least two rows below it, and a step to the next row of at most 1.5 times their spacing. A caption such as `Table 1`, heading-size text, or an unstyled centred line stays outside the table; the unstyled line adds a `LAYOUT_DEGRADED` warning, and it is no longer placed in the first column.
- 19f9cff: Apply loader fallback and stage deadlines to classification. Run independent classifiers concurrently while preserving their registered signal order.
- dad34aa: Read two-column pages column by column when the gutter is narrow or the columns differ in width, and keep an indented first line ahead of the rest of its column.
- 19f9cff: Allow rasterizer constructor defaults to apply to lazy page images. Composition defaults and explicit image-call options still take precedence.
- 19f9cff: Check sequential reuse and concurrent document isolation on the same loader instance in the conformance suite. Dispose every instance created by a conformance case.
- 19f9cff: Report inapplicable loader conformance checks as skipped. A loader's legitimate refusal of a scanned input remains a passing check.
- 9fc9b6a: Conversion no longer joins a contents or index entry, such as `Contents .......... 7`, with a lowercase paragraph on the next page. An entry ends in an Arabic or Roman page number after a dot leader or a wide gap; both paragraphs stay on their own pages without continuation provenance. A final number after an ordinary word space still allows the join.
- a5ddf09: Pass contract and selected classification hints through `StrategyContext.hints` to LLM text and vision prompts. Context hints appear before the strategy's classification-specific hints.

  Process forwards the selected kind's hints, falling back to its extraction contract's hints, without adding classifier calls. A selection with no guidance does not borrow another candidate's hints. Existing classifier calls, verdicts and usage remain unchanged.

  Outside Process, a `Contract` that defines `hints` sends them, including an empty string, even when the extractor or the call supplies other candidates. A `Contract` without hints uses the hints of the candidate the classification names. When no candidate is named, a sole candidate's hints apply only to a bare schema or a `Contract` with the same name, so an unrelated candidate no longer supplies hints for a different contract.

- dad34aa: Convert pages with thousands of lines or table rows in a fraction of the previous time.
- dad34aa: Docling's synchronous `convert()` is bounded by the new `convertTimeoutMs` (default `jobTimeoutMs`) rather than the 30 second request timeout. Retried GETs back off exponentially with jitter and honor `Retry-After`. A retry wait that would outlast the request deadline is skipped, so the caller gets the HTTP status and detail instead of a timeout. HTTP errors include a bounded excerpt of Docling's `detail`.
- b709d9e: Hash rendered page content in vision cache keys so different documents and image sizes receive their own responses. Vision cache entries from earlier versions are no longer used. Existing file-cache entries remain on disk until removed.
- b709d9e: Derive extraction features from selected pages. Empty or missing-page selections raise `PageSelectionError` with `PAGE_OUT_OF_RANGE`, missing page numbers, and the document page count. Preserve text-only conversion paragraphs and stop unmarked list items from absorbing following content.

  Selected pages use the existing 50-character `TEXT_LAYER` threshold. Short digital selections may need another eligible strategy, including when extracted as a `Process` group.

  Score matching empty containers as equal. Require matching digit sequences before fuzzy string comparison. Compare validated ISO and English month-name dates by their written calendar day without time-zone conversion.

- dad34aa: Reject saved conversion JSON with out-of-order page numbers, negative sizes, or text that disagrees with its runs.
- 19f9cff: Document current loader names, structured output, diagnostics, concurrency, JSON conversion, eval gates, credentials and disposal. Generate the package README and error catalogue from their sources. Add executable documentation drift checks and attached, typechecked class examples.
- dad34aa: `TextSplitter` and `ImageSplitter` keep a page that the model listed under two documents only in the more confident one, so an eager split never extracts a page twice.
- a5ddf09: Send every page of an eager split to the model in bounded windows. Join windows only after a seam check confirms the document continues, keeping the earlier classification and lower group confidence. Ignore model page numbers outside their request window.

  `maxEagerPages` must be a positive integer.

- dad34aa: Accept a model in `ExtractorOptions.llm`, check every component before `loadLlm` registers any, and name the fix in duplicate-component, no-loader and no-strategy errors.
- dad34aa: Measure word gaps against the font size instead of the line box, so MuPDF output keeps the spaces in `Gulf Coast Association` and in the narrow Latin spaces of CJK documents.
- 9fc9b6a: Conversion no longer adds a form section to the table above it just because its cells fall in the table's columns. A row more than 1.5 times the row spacing below the row above, with fewer cells than the table or a different font weight, starts a new section, so receipt labels such as `Booking ID` and `Payment Mode` and their values stay out of the `Check In`/`Check Out`/`Rooms` table. A totals row with a number in the last column still joins after a wider gap. The same rule ends rows that continue a table on the next page. Two-column pages also no longer drop a line that shares its row with a line spanning both columns.
- dad34aa: `application/octet-stream`, `binary/octet-stream` and empty declarations no longer override the file signature or extension, and known types are matched case-insensitively. A declared `charset` now decodes text in `DocumentLoaderData`, except that a UTF-8 or UTF-16 byte order mark decides the encoding over it and is dropped from the text. `DocumentLoaderData` also reads `text/html` and `application/xhtml+xml` as HTML whatever their case or parameters, such as `Text/HTML; charset=windows-1252`, and email attachments keep the sender's file extension so an octet-stream DOCX still resolves.
- 19f9cff: Extract visible HTML and XHTML text in DocumentLoaderData. Drop scripts, styles, templates, noscript, head content and comments. Preserve block order, heading and list hints, table cells and decoded entities on one page.

  Use lazy standards-aware HTML parsing and an XML fragment parser for XHTML. Preserve omitted head/body markup, complete character references, textarea text and literal CDATA without fetching external resources.

- a5ddf09: Report cached layout analysis tokens without charging their cost again.
- dad34aa: Ignore a layout analyzer's heading level outside 1 to 6, and call the model again when a cached LLM layout analysis fails its schema.
- dad34aa: Lazy splits report each group with the pages' own page numbers instead of positions counted from 1.
- dad34aa: Join the unmarked wrapped lines of a tagged list item to that item instead of numbering each line, and continue an ordered list from the previous item when an item has no number of its own. A one-line bold numbered title such as `1. INTRODUCTION` followed by body text is a section heading.
- dad34aa: Keep links in list items, end a numbered list at a larger numbered section heading, split plain-text list lines into items, and assign heading levels from the whole document's heading sizes.
- dad34aa: `LlmClassifier` matches the model's answer to a candidate name ignoring surrounding spaces and returns the candidate's own spelling. An exact match wins; a match that ignores case counts only when one candidate fits, and otherwise the classifier abstains with a note. A candidate named `Unknown` can be chosen; `unknown` means abstention only when no candidate has that name.
- dad34aa: Name the components an `LLM` builds after its model id, such as `gpt-5`, `gpt-5:vision` and `gpt-5:classifier`, so two different models can be loaded as a fallback chain. `result.method`, attempts and telemetry ids now show the model id instead of `llm`.
- dad34aa: Escape fences, indentation, table pipes, entity references, strikethrough, and trailing heading hashes in Markdown output, escape hyphen runs such as `-- -` that would draw a rule, fence code with enough backticks, wrap link destinations with spaces in angle brackets, percent-encode line breaks in link destinations, and percent-encode asset paths.
- dad34aa: Merging partial extractions keeps fields named `constructor`, `toString`, or `__proto__` as data instead of replacing them with built-in members or changing the merged object's prototype.
- a5ddf09: Replace an earlier numeric zero or false with a later non-zero value of the same type when merging extraction chunks. Arrays still concatenate, and other present values keep their first occurrence.
- dad34aa: Keep the wrapped tail of a monospace URL in its paragraph instead of fencing it as code.
- 19f9cff: Yield to Node between MuPDF pages so timers, I/O, and cancellation can run. Keep each synchronous engine operation scoped to its caller's logger.
- 19f9cff: Use Node's native CRC implementation while encoding PNG assets when available. Retain the JavaScript fallback for Node 22.0 and 22.1.
- dad34aa: Scale a word's `style.fontSize` with its box in `linesFromWords`, so an OCR loader that reports pixel font sizes measures word gaps in points.
- dad34aa: A PDF given to `DocumentLoaderTesseract` or `DocumentLoaderPaddleOcr` without a `rasterizer` now fails with a `NO_ELIGIBLE_LOADER` reason that says to pass one. Loaders can declare such reasons with the new `capabilities.declines` map.
- dad34aa: Remove an incrementing number as page furniture only when it reads as a page number, so a header such as `Invoice number 1001` stays in the body. A page number counted from any offset, such as a journal folio `245` on the first page, and a page label at either end of a running title, such as `Annual Report 2024 · Page 3`, are still removed.
- 9fc9b6a: Conversion now recognizes a running page number printed just below the top margin band or just above the bottom one, such as `Page 2 of 6` at 12% from the top of a statement. Between 10% and 15% of the page, a line becomes a `page-header` or `page-footer` with `evidence: "repeated"` only when it is page-number text that follows the pages, keeps one height and indent on at least three pages and 60% of them, and has a line of blank space between it and the body. Markdown and HTML leave it out; TXT and JSON keep it. The general band stays at 10%, so other repeated text in that region, and a page number at another height, stays in the body.
- dad34aa: `PageSelectionError` messages use the singular for one page, as in "Page 9 does not exist. The document has 1 page."
- dad34aa: `PageSelectionError` no longer blames the document for a limit it did not set. A page past a loader's `maxPages` limit says so, as in "Page 5 is outside the first 3 pages that maxPages allows. The document has 10 pages.", and the error carries `maxPages`. A selected page missing from the pages a loader returned now says "Page 5 was not loaded. The loaded pages are 1-3." instead of stating a document length the pipeline does not know, and the error carries `loadedPages`.
- dad34aa: `PaperlessSource` rejects a `timeoutMs` above 2147483647, the longest delay a Node timer can wait. A larger value previously expired after 1 ms.
- a5ddf09: Decode each row of a PDF.js monochrome image from its byte-aligned start. Embedded images whose width is not a multiple of eight now retain the correct pixels.
- dad34aa: The pdf.js loader now reads bold, italic and the real font name in layout mode, including abbreviated embedded names such as `NimbusRomNo9L-Medi`. It gives rotated text a rotated box, and places images drawn inside Form XObjects through the form's matrix. Outside layout mode it no longer reports `bold: false` for fonts it never loaded.
- 3494ca0: PDF.js now decodes JPEG 2000 and JBIG2 images. `NapiCanvasRasterizer` used to render those images as blank areas, so scanned PDFs that use them gave OCR an empty page. `DocumentLoaderPdfJs` now returns them as image assets. PDF.js warnings no longer print to the console.

  `DocumentLoaderTesseract` now reads a local `langPath` directory that holds plain `<lang>.traineddata` files, the form docture's cache stores. Before, it looked only for `<lang>.traineddata.gz` and the load never settled. A directory that lacks a language's model now rejects with `MissingComponentError` naming the missing file.

- dad34aa: A loader, classifier or strategy that throws its own `AbortError` or `TimeoutError` (for example from `AbortSignal.timeout()` inside an HTTP call) now counts as a failed attempt, so the next component still runs. Only an abort of the caller's own signal stops the pipeline.
- dad34aa: `Process.extract()` rejects a `concurrency` that is not a positive integer with `InvalidOptionError` (code `INVALID_OPTION`) before reading the source. `NaN` previously started no workers and returned empty results.
- dad34aa: When one `Process` group fails, the groups still running are cancelled and no further groups start.
- dad34aa: `Process` keeps the loader's capability facts and a loaded source's `facts`, so strategies and splitters that require a custom fact stay eligible.
- dad34aa: `Process.extract()` and `splitOnly()` take an options object built with `Object.create(defaults)` or a class as options. Before, any object without a plain prototype was read as the document source.
- dad34aa: `Process` extracts each group under the classification the split gave it. The extractor's classifiers no longer run again per group, so they cannot contradict the split or add a model call.

  The result retains that classification even when the extraction strategy requests no classification or returns a different one.

- dad34aa: Read two columns of wrapped prose, such as justified Chinese text or a MuPDF page with one span per word, as paragraphs instead of two-column tables.
- 19f9cff: Accept providerOptions in text and vision extraction and include their stable JSON values in response cache keys.
- dad34aa: `NapiCanvasRasterizer` and `MuPdfRasterizer` cap a page at 40 megapixels by default and lower the DPI to fit, so an oversized page no longer allocates gigabytes. Set `maxPixels` to a number of at least 1 to change the cap, or to `Infinity` to turn it off. Page images keep the eight most recently used renders per document instead of every render.
- dad34aa: `RawDocument` has an optional `charset`, which `resolveSource()` keeps when a caller sets it, and loaders match media types without case, so a custom type routes to its loader whatever its spelling. Resolved media types are now lower case.
- 19f9cff: Release OCR raster buffers after recognition while keeping lazy page images available. The image closures retain only page numbers and the source document.
- a5ddf09: Keep schema properties named `required` in chunked extraction requests while removing required-field lists.
- 19f9cff: Retry failed lazy initialization in PDF.js, MuPDF, canvas, Tesseract, and PaddleOCR adapters. Concurrent calls continue to share one initialization attempt.
- 19f9cff: Retry failed lazy page renders in composed, Tesseract, and PaddleOCR loaders. Successful and concurrent calls continue to share rendered images.
- dad34aa: The pdf.js and MuPDF loaders report a `rotation` on runs that are not horizontal, and rotated words form their own lines. Conversion keeps rotated text such as an arXiv side stamp out of headings and body paragraphs and places it after the page body.
- 9fc9b6a: Reject an `onRuleFailure` other than `"report"` or `"fail"` when the extractor is created or before a call runs any strategy, and reject a validation rule that returns something other than an array of `{ path, message }` issues with a `TypeError` that names the rule.
- 9fc9b6a: Apply a caller schema's transforms once per extraction result. The text and vision strategies now return the model's answer before validation, so fresh, cached, cited and repaired answers no longer pass through a transform twice. A validator that changes the answer in place also takes effect once. Text and vision extraction answers cached by an earlier version are not reused, so the first run after upgrading makes those model calls again.
- a5ddf09: Use specific magic bytes to correct generic or conflicting known media types, including HTTP content types. Strip declaration parameters and lowercase the declared type, while preserving ZIP-based types and declarations for bytes without a known signature. Require the WEBP marker when recognizing RIFF files.
- dad34aa: `runSplitter` rejects a splitter's groups with `SplitFailedError` when they repeat a page, leave a page out, name a page the bundle does not have, or include a group with no pages. The message names the pages and each empty group. The error carries `coverage` with the `overlaps`, `missing` and `unknown` page numbers and includes it in `toJSON()`. Its hint says to return groups that cover every page once, instead of the image-splitter advice.
- 9fc9b6a: `TextSplitter` and `ImageSplitter` default to the names `"TextSplitter"` and `"ImageSplitter"` instead of the runtime class name, so a minified bundle or a subclass keeps the splitter's telemetry `functionId` and component name. An explicit `name` still wins.
- 19f9cff: Use the AI SDK structured text output API for extraction, classification, splitting and layout analysis. Preserve schema-failure codes and billed usage.
- dad34aa: Tesseract no longer writes into the caller's Buffer, or into Node's shared buffer pool, when it reads page 2 or later of a multi-page TIFF.
- dad34aa: Tesseract reads a JPEG with EXIF orientation upright, whether the EXIF block is big- or little-endian, and reports the upright page size and page image. With `autoRotate`, word boxes are turned back onto the page image instead of staying in the deskewed frame.
- 19f9cff: Terminate Tesseract workers that finish starting during disposal or fail parameter setup. Disposal drains pending worker creation and prevents further recognition on the disposed pool.

  Report termination failures consistently for ready and late-starting workers. Reject queued loads after the last startup failure so later loads can retry instead of hanging.

- 3494ca0: Convert PDF.js and MuPDF text layers to readable Markdown. Wrapped lines of one paragraph, list item, title, or code listing now form one element instead of one paragraph per line, and code keeps its indentation. A Courier font counts as code even when MuPDF reports it as proportional. Headings are measured against the font size of most of the page's characters outside table rows, so diagram labels and small-print tables no longer turn body text into headings. A numbered line set larger than the body, such as `2. Transactions`, is a heading. Ordered lists keep their original numbers and delimiters in Markdown, and HTML sets `start` when a list does not begin at 1. Markdown escapes a leading `#`, `+`, `-`, number, or underline on every line of paragraph text.
- 9fc9b6a: Conversion no longer joins an unrelated text-only grid on the next page to a table without a number column just because the columns line up. Such a table continues only after a copy of its header row, or under a line such as `Table 4 (continued)` that names the caption right above the table. Otherwise both tables stay on their own pages with their own provenance, and the result carries one `LAYOUT_DEGRADED` warning naming the table's last line and the first unjoined row. A bold or heading-size section title set apart at the top of the next page now ends any table, even when a header copy follows it.
- 9fc9b6a: The Tesseract and PaddleOCR loaders refuse a TIFF page whose samples decode to more than 256 MiB, such as a 16-bit RGBA page at 8192 x 8192, before decoding it. PaddleOCR inflates a Deflate page once instead of twice and converts pages to PNG in bands of rows, which lowers peak memory: decoding an 8192 x 8192 8-bit RGBA Deflate page fell from 1650 MB to 632 MB maximum resident set on Node 24.
- dad34aa: Join text-layer runs that touch without inserting a space, so citations read `(Newkirk, 1971;` instead of `( Newkirk, 1971 ;`, and order right-to-left lines from the right edge.
- 9fc9b6a: Conversion no longer takes a two-page running header, such as `Report 2026` at the top of both pages, as a row of a table that continues onto the next page. A band line that repeats at the same place on another page without qualifying as furniture stays body text outside any table, and a table never continues across or through it. The rows stay on their own page, and the result carries one `LAYOUT_DEGRADED` warning naming the table's last line, the first row, and the repeated line. A loader-tagged header is still removed before the join, and a table header that repeats at the top of each page still joins.
- dad34aa: `Attempt.errorCode` and OCR fallback warnings are typed as `DoctureErrorCode`, and `safeConvert()` types its failure as `DoctureError | Error`, like `safeExtract()`.
- 9fc9b6a: A path or `file:` URL that cannot be read now raises `UnsupportedSourceError` (`UNSUPPORTED_SOURCE`) instead of the raw file-system error. The message names the path and what to do: a missing file, a directory, and a file without read permission each get their own guidance, and `cause` keeps the original error with its `code`, such as `ENOENT`. The CLI reports these as `UNSUPPORTED_SOURCE` with a recovery hint instead of `INTERNAL`, and still exits 1.
- a5ddf09: Neutralize document and excerpt delimiters embedded in input text so the text cannot close its own prompt wrapper. Preserve other text and prompt bytes when no matching tag occurs.

  Expose `wrapUntrusted(tag, text)` from the prompt utilities for the same deterministic wrapping behavior.

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

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

  - @docture/core@0.1.0

## @docture/eval before consolidation

## 0.0.3

### Patch Changes

  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

  - @docture/core@0.1.0

## @docture/loader-pdfjs before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

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

  - @docture/core@0.1.0

## @docture/loader-mupdf before consolidation

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

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

  - @docture/core@0.1.0

## @docture/loader-tesseract before consolidation

## 0.1.1

### Patch Changes

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

  - @docture/core@0.1.0

## @docture/loader-paddleocr before consolidation

## 0.1.1

### Patch Changes

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

  - @docture/core@0.1.0

## @docture/raster-canvas before consolidation

## 0.0.3

### Patch Changes

  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

  - @docture/core@0.1.0

## @docture/testing before consolidation

## 0.1.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

  - @docture/core@0.2.0

## 0.0.2

### Patch Changes

  - @docture/core@0.1.0
