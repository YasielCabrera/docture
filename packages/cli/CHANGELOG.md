# @docture/cli

## 0.3.0

### Minor Changes

- dad34aa: Add `timeoutMs`, a deadline for a whole call, to extraction and classification options, `ConvertOptions`, `Process.extract()` and `splitOnly()`, and as a default on `Extractor` and `DocumentConverter`. When it passes, every component's signal aborts and the call rejects with `TIMEOUT` at stage `"call"`, even when a component ignores its signal. The layout analyzer stage deadline now abandons an analyzer that ignores its signal. The CLI `--timeout` flag is now this per-document deadline, applied with each call so it also bounds an extractor or converter the config supplies already built. `review --timeout` covers the document's conversion or extraction and its page rendering together, and the service's `flags.timeoutMs` bounds each request's whole call. Set `stageTimeoutMs` in `docture.config.ts` for a per-stage deadline.

  The public `runPipeline()` function also enforces `timeoutMs`. Deadlines keep standalone Node calls alive until they settle and reject late splitter results. `review --timeout` includes reading source bytes. CLI commands validate the flag before configuration or resource setup, including dry runs.

  A `timeoutMs` or `stageTimeoutMs` above 2147483647 ms, the longest delay `setTimeout` accepts, sets no timer, including in `review`. Before, the runtime clamped it to 1 ms and the stage or call timed out at once.

- 9fc9b6a: Report `minOcrConfidence` on field citations: the lowest OCR span confidence behind a verified match, or across the cited lines of a cited-unverified value. It is absent unless every relevant span has a score and each cited line's text is its spans joined by single spaces. `docture review` shows it beside each field.
- 9fc9b6a: Add the `@docture/cli/config` entry. It exports `defineConfig`, `DoctureConfig`, and the `CliExtractor` and `CliConverter` types, and it has no runtime imports, so a tool that reads a `docture.config.ts` loads neither the CLI nor `docture`. Documented config examples now import `defineConfig` from `@docture/cli/config`. The root `@docture/cli` entry still exports `defineConfig` and `DoctureConfig`, so existing configs keep working.
- dad34aa: `convert --to` accepts the library's format names `markdown` and `text` beside `md` and `txt`. `convert --pages` and `inspect --pages` accept ranges such as `2,4-6`, selecting at most 100,000 pages, and `inspect --max-pages` names the first-n-pages limit that a bare `inspect --pages 3` still applies.
- 19f9cff: Choose stdout and stderr color independently and remove terminal escape controls from machine error messages and hints.

  Breaking change. Custom Io implementations must provide stdoutColor. captureIo defaults it to false.

  Apply NO_COLOR at the run boundary so custom Io implementations suppress ANSI on both streams.

- a5ddf09: Use one versioned JSON output envelope for `extract`, `convert`, `classify`, `inspect`, and `eval`: `{ version: 1, command, ok, results, summary? }`. Result items include the file and either successful command data or a structured error with a required code, message, and optional hint. Failures remain in every machine-readable output.

  Breaking changes:

  - `extract` defaults to this envelope for one or many inputs, including failures. Replace `jq .total` with `jq '.results[0].data.total'`. `--full` adds metadata to successful items without changing the envelope.
  - `--format json|ndjson|text` selects result output on every command. `classify --json` and `inspect --json` are removed. The other commands keep text as their default.
  - `convert --format md|html|txt` becomes `convert --to md|html|txt`. `--format` now selects result encoding. JSON conversion results list the written document, assets, and warnings.
  - `extract --out <file>` writes the selected run output, with an envelope for JSON. Directory output writes one result item per file, including failures, instead of bare extracted data.
  - `extract` refuses known aliases of local inputs in `--out` destinations, including through file URLs, symbolic links, or hard links. It also refuses missing files when native parent traversal and terminal symlinks identify the same destination after planned output folders exist. It exits with code `2` before config or schema imports and model resolution and asks for a different destination. Unsafe output takes precedence over invalid config or schema errors. Sources and output files remain untouched on refusal. Directory output may first create empty destination folders; single-file output does not create parents. If permissions or another unknown filesystem error prevent inspecting an input, an existing destination requires a new output path, even if it is unrelated. Uninspectable destinations are also refused. Safe new output paths still retain per-document errors and let other batch inputs continue. Missing inputs and symlink loops retain per-document errors with safe existing destinations.
  - NDJSON emits the same result items as `results[]`, one per line in completion order, without an envelope. JSON retains input order.
  - `eval --format json` includes aggregate metrics and the accuracy gate verdict in `summary`. Failed document metrics are zero. `--report` continues to write a Markdown scoreboard in all formats.
  - `explain()` always returns a code, including `USAGE`, `CLI`, and `INTERNAL` for errors outside the library's error hierarchy.

- b709d9e: Consolidate the library into `docture` with explicit ESM subpaths and retain the separate `@docture/cli` package. The root now exports core APIs only. Import model APIs from `docture/llm` or a narrow entry such as `docture/llm/text`. Replace scoped loader, rasterizer, eval and testing imports with the documented `docture/...` paths.

  Engine dependencies are optional peers and must be installed explicitly for the selected integration. PDF.js, canvas, MuPDF and PDFKit accept ranges (`^6.2.108`, `^1.0.10`, `~1.28.0` and `>=0.17.2 <0.21.0`); Tesseract.js, PaddleOCR and ONNX Runtime stay at exact versions. An application that already depends on another release of an OCR engine needs the npm override in the installation guide to install `docture` for core use. The canvas rasterizer draws on the canvas that PDF.js loads, so pages render when a package manager installs a separate canvas for PDF.js. Model integrations accept Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later. An adapter whose engine is not installed throws the new `MissingEngineError` (`MISSING_ENGINE`) with the package and range to install; the CLI prints an install hint instead of calling the file damaged. Error classes recognize instances from another installed copy of `docture`, so usage, codes and fallback survive when pnpm installs separate copies for an application and the CLI. A typed CLI config accepts an `extractor` or `converter` built by either copy. The CLI retains AI SDK and PDF.js dependencies and its optional native canvas installation. Testing doubles, fixtures and conformance suites have separate entry points. Fixtures need PDFKit; conformance suites need Vitest and use those PDFKit fixtures.

  This changes existing imports and dependency installation. See the migration guide before upgrading. All wrappers ship in the library tarball. Production bundlers can prune unused ESM modules; convenience classes retain their referenced capabilities.

- 9fc9b6a: `convert`, `safeConvert`, and `convertBatch` accept `pages`, a list of original one-based page numbers. The converter copies the list when the call starts, asks the loader for only those pages, and keeps only those pages for preloaded sources and loaders that ignore the hint. Text, Markdown, HTML, and JSON results, features, and assets cover the selected pages and keep their original page numbers, and tables and paragraphs join only across consecutive original pages. An empty selection or a missing page throws `PageSelectionError` (`PAGE_OUT_OF_RANGE`), as extraction does.

  The MCP `convert` tool accepts the same `pages` argument. Malformed pages are invalid parameters, and a page the document lacks fails the item with `PAGE_OUT_OF_RANGE`.

- 3494ca0: Make OCR reachable when converting scans.

  - `DocumentConverter` tries the next eligible loader when a loader recovers no text from the selected pages, so an OCR loader listed after PDF.js reads a scanned PDF. The skipped loader appears in `attempts` with status `"skipped"`. Extraction keeps its current loader routing.
  - `NoConvertibleContentError` now says how to OCR a scan, and names `withOcrFallback` for mixed documents.
  - `withOcrFallback(primary, ocr)` no longer needs options. Pages with fewer than 20 characters of trimmed text go to OCR. The defaults are exported as `textLengthQuality` and `DEFAULT_OCR_THRESHOLD`.
  - `ConversionResult.ocrFallback` reports which pages `withOcrFallback` sent to OCR, which loader supplied each page, and per-page OCR warnings. The versioned JSON output is unchanged.
  - A disposed `DocumentConverter` rejects new conversions with `DisposedError` (`DISPOSED`), and a conversion in flight stops before it starts another loader or OCR page. Before, converting after `dispose()` started a new OCR worker pool that nothing released.
  - `docture convert --ocr tesseract|paddleocr` rereads pages with too little text using that engine. A missing engine fails with its install command instead of an empty result.

- ad9cc23: Publish @docture/eval with schema-driven evaluation, project-defined datasets, versioned results, comparison, gates, reporters, calibration, grounding, framework adapters and an optional LLM judge. Replace docture/eval with the new package, move conversion checks to @docture/eval/conversion, and add the docture eval subcommands and stable eval error identities.
- dad34aa: Invalid arguments to the MCP `convert`, `inspect`, and `extract` tools now return an `isError` result with code `USAGE` and a hint, instead of a JSON-RPC error, so the model can read and correct them. A tool name the server does not list is still a JSON-RPC error, including `list_schemas` without `schemas`, an unconfigured or misspelled Paperless tool, and `paperless_apply` without `enableApply`. Hints in MCP tool errors no longer name CLI flags, and an unknown `schemaName` on a server with only a default `schema` says to omit it.
- dad34aa: When the config defines `schemas`, the MCP server lists a `list_schemas` tool and enumerates the names on `extract.schemaName`.
- dad34aa: MCP tools now declare an output schema and read-only annotations. `convert` returns at most `maxChars` characters (20000 by default) from `offset` and reports `totalChars`, `truncated`, and `nextOffset`, so an agent can read a long document in parts. A part never splits a surrogate pair, even when `maxChars` is 1.
- 16239e2: `docture review <file> -o review.html [--dpi 96]` writes one self-contained HTML file that draws every conversion element's box over the rendered page, with its id, kind, and escaped text. Boxes use percentages of the page size. A table or paragraph that continues onto later pages gets one box per page, running headers and footers are visible, and tables keep their merged cells. `docture review --conversion report.json --source report.pdf` reviews a saved version 1 or 2 `convert --to json` file; malformed JSON exits 2. Page images are data URIs and a Content-Security-Policy blocks network requests. `--dry-run` and `help --json` cover the command.
- 16239e2: `--dry-run` on `extract`, `convert`, `classify`, and `eval` resolves and validates the config, schema, inputs, output targets, truth files, model route, credentials, and wiring, then prints one JSON plan envelope with `summary: { dryRun: true }` and exits 0. Each result's `plan` names the input, loaders, strategies, classifiers, model, schema, and output target. It loads no document, reads no stdin, calls no model, and creates no output or cache directory. An extractor or converter factory from the config is not called and is reported as `opaque: true`. An invalid invocation still exits 2.
- 16239e2: `docture review <file> --schema <path> --model <provider/id>` extracts with citations and lists every present field beside the page images with its citation status. Selecting a field, by click or with the arrow keys, highlights exactly the lines it cites; an uncited field highlights nothing. `docture review --extraction result.json --source original.pdf` reviews a saved `extract --full` result, validated first; an envelope with several results needs `--item <n>`. The page holds one small inline script, allowed by hash, and makes no network requests.
- 16239e2: Opt-in field citations for text extraction. `llm({ model, citations: true })`, `createLlmExtractor({ llm: { citations: true } })` and `new LLM(model, { extraction: { citations: true } })` show the document to the model as lines with canonical `p<page>-line-<n>` IDs and ask for `{ data, citations }`. Each present leaf of `result.data` then gets one `FieldCitation` in `result.citations`: `verified` when the value was found in the cited lines (with `ids` narrowed to exactly the lines the match spans), `cited-unverified` when the lines exist but do not show the value, or the caller's schema changed it, and `uncited` otherwise. `result.citationSources` lists the cited `SourceLine`s with their boxes. Verification is exact: strings after NFKC and whitespace collapsing, numbers after currency, grouping and parentheses, and ISO dates against unambiguous printed dates only, so `05/03/2024` stays `cited-unverified`. An ID the request never showed is not evidence. Array indexes are rebased across `paginate` and `concatenate` merges, caller refinements and transforms still run, and a cached answer is validated and verified again on every hit. Citations add prompt and output tokens, and long tables can make an answer truncate. Vision extraction and documents without positioned lines are never cited, and with citations off every request is unchanged. New types: `FieldCitation`, `CitationStatus`, and, for custom strategies, `OutcomeCitation` on `StrategyOutcome.citations` and the `data` variant of `RepairInput`.

  `docture extract --citations --full` adds `citations` and `citationSources` to each result record, and `--full` now also adds `validation` and, when present, `conflicts`. `--citations` without `--full` is a usage error, and it warns when config strategies replace the model's.

- 16239e2: `docture help --json`, `docture help <command> --json`, and `docture <command> --help --json` print the command specs as a version 1 envelope with command `help`. Each result lists the command's positionals and flags with short aliases, choices, default labels, and descriptions, and the summary lists the environment variables. The parser now rejects a value outside a flag's documented choices, and `docture help <unknown>` exits 2 instead of printing the overview.
- 16239e2: `docture mcp` serves Docture to an agent host over Model Context Protocol stdio, and the new `@docture/cli/mcp` entry exports `createMcpServer({ io, signal?, configPath?, noConfig? })` for any SDK transport. The server has two model-free tools. `convert` takes `{ source, format? }` with Markdown, HTML, text, or JSON, and returns the content without writing files. `inspect` takes `{ source, pages? }`. Both return the CLI's version 1 envelope as structured content and JSON text, and a failed document sets `isError` with the CLI error code. Stdout carries only protocol frames, and the server stops at end of input or on Ctrl-C.

  `@modelcontextprotocol/sdk@1.32.2` is a new optional peer. Install it to use `docture mcp`; no other command or the root entry loads it.

- 16239e2: A `-` file argument reads the document from stdin in `extract`, `convert`, `inspect`, `classify`, and `eval`. The result is labelled `stdin`, and directory output is named `stdin.json` or `stdin.<extension>`. Passing `-` twice exits 2 before stdin is read. `eval` accepts stdin only as its single input and only with `--truth <file>`.

  Breaking for code that implements `Io` itself: `Io` now requires `readStdin(signal?): Promise<Uint8Array>`. Return an empty `Uint8Array` if your host has no stdin. `captureIo({ stdin })` supplies the bytes in tests.

- ea4b757: Make the core and chunk entries portable and move local file defaults to docture/node. Add checked construction, extraction tools, descriptive calibration reports, Docling native evidence and service conversion, Paperless sources and fill-empty write-back, DOCX/EML inputs, and explicit page OCR fallback.

  Add warm localhost HTTP service operations and configured Paperless CLI/MCP extraction and plan/apply. Preserve native element/cell evidence through saved JSON, chunks and review. Correct shared resource disposal, batch concurrency, HTTP source failures and OCR render caps. Ship installed consumer guides and container build/smoke recipes.

- 5536666: Publish @docture/synthetic. It generates labeled synthetic documents from an extraction schema, with seeded models, generators, constraints, scenarios, printed masks and typed templates. Each label records the field's value, page and box. Optional entries render with PDFKit or Chromium, verify labels through PDF.js, measure how far a template's text drifts from a reference PDF, add scan, photo and fax degradations with sharp, generate locale-aware values with Faker, build cached text pools with an AI SDK model, and write corpora that @docture/eval reads.

  @docture/eval now reads expected field locations from the `locations` field of `jsonlDataset` rows and from a `locations.json` file in each `folderDataset` case. Docture adds the error codes `SYNTHESIS_FAILED`, `TEMPLATE_INVALID` and `LABEL_VERIFICATION_FAILED`.

- f898761: Add React templates to @docture/synthetic. The new `@docture/synthetic/react-pdf` entry defines templates as React components rendered with `@react-pdf/renderer`: `defineReactTemplate` takes a `render` function that returns pages, and each printed value sits in a `<Field path>` whose label box comes from react-pdf's layout. Fields typed from the model, automatic page wrapping, repeating headers, custom fonts and async asset preparation are supported, and missing glyphs, mask mismatches and unboxable fields fail with `TemplateError`. `react` (>=18.3.1 <20.0.0) and `@react-pdf/renderer` (4.9.0) are optional peers.

  The root exports `RenderingTemplate` and `SynthTemplate`, and `@docture/synthetic/pdfkit` exports `renderTemplate`, so `writeCorpus`, `defineSynthConfig` and `docture synth` accept React templates beside PDFKit templates. `docture synth` explains how to load `.tsx` templates when Node cannot import them.

  `verifyLabels` now accepts letter-spaced text, which PDF.js reads back with spaces between glyphs, by comparing the spans centred in a label's box without whitespace.

- 19f9cff: Export conversion layout as versioned JSON with original element IDs, provenance, final warnings, and referenced, embedded, or omitted assets. Add the json document format to docture convert --to.

### Patch Changes

- 49d0324: Ship the complete offline Markdown documentation once in `docture`, generated on build and pack. Expose `docture/docs/manifest.json` for discovery with exact documented package versions and content hashes. Point each package's agent guide to the installed snapshot and reject unreleased documentation during publication.
- 19f9cff: Validate config fields and component factories when loading them. Report the config path, invalid field, and close spelling suggestions as usage errors.
- 19f9cff: Reject missing provider or gateway credentials before loading documents. Allow cache reruns, custom OpenAI base URLs, and configured compatible models to work without a hosted-provider key.

  Construct a keyless OpenAI-compatible provider for an explicit OPENAI_BASE_URL, verified with the real SDK request path.

- 19f9cff: List provider credentials, gateway credentials, NO_COLOR, and the custom OpenAI endpoint variable in command help.
- a5ddf09: Include failed extractions in the eval scoreboard, report, aggregate metrics, and `--min-f1` gate. A failed document has F1, precision, and recall zero, including when its truth is empty. Failed cases in `@docture/eval` contribute omitted truth to aggregate metrics.
- dad34aa: A one-shot command now exits as soon as its output is flushed. Before, work that `--timeout` abandoned could keep the process alive until it settled. `docture mcp` and `docture serve` still run until they shut down.
- 351d64d: Correct `docture` help text: `docture mcp` lists its configured extraction and Paperless tools, flags that take a value show a placeholder, and command descriptions no longer promise free re-runs or describe internals.
- 19f9cff: Load command implementations only after help and version handling. Keep synchronous error explanation free of runtime model dependencies.
- dad34aa: The CLI prints core's `LOAD_FAILED` hint, which says to read each attempt's error, repair or decrypt the file, or register a fallback loader.
- 19f9cff: Name missing dependencies imported by a config or schema and explain how to fix their imports.
- a5ddf09: Keep per-document failures visible on stderr under `--quiet` in every command. Show the first available hint per error code while hiding progress, warnings, and summaries.
- 9fc9b6a: Interrupting a command that reads a document from `-` now stops the stdin read at once, even when the pipe stays open and sends nothing. The read rejects with the abort reason, releases stdin so the process can exit, and no longer starts reading at all when the run was already aborted. A read that reaches the end of input still returns every byte.
- dad34aa: With an explicit `--format json` or `ndjson`, a wrong invocation also writes a version 1 envelope with the error code, message, and hint to stdout. `extract --out` keeps stdout empty and writes no out file for a wrong invocation, so check the exit code before reading the file. Runs without `--format` keep stdout empty on failure.
- 9fc9b6a: Conflict, citation and schema issue paths now quote a key that is empty or contains a dot or a backtick, so the literal key `"a.b"` (`` `a.b` ``) no longer collides with the nested field `a.b`. A single part with both no longer reports a false conflict. `formatFieldPath` and `parseFieldPath` write and read the path text. The CLI review page matches citations by the same paths.
- b709d9e: Report optional `cacheReadTokens` and `cacheWriteTokens`, and price provider cache reads and writes at configured rates. Missing cache rates use the input rate. Export `sumUsage` to combine usage with the same rules across extraction, splitting, and conversion.

  Include classifier calls and schema-failed model calls in reported usage. Classifier options now accept `pricing` and `instructions`. `ModelOutputError` carries `MODEL_OUTPUT_FAILED`, the SDK cause, and available usage. Failed extraction attempts retain this usage through fallback.

  Direct strategy, layout-analyzer, and splitter calls now throw `ModelOutputError` for schema failures. Code that checked `NoObjectGeneratedError.isInstance(error)` must inspect `error.cause` instead. Configured shared instructions now reach the classifier prompt, which can change its verdicts and makes classifier cache entries created without those instructions unreachable.

  Share cache, pricing, temperature, retries, and instructions with vision and classification in `createLlmExtractor`. CLI classification shares its available model options and cache with the strategies.

- 19f9cff: Document current loader names, structured output, diagnostics, concurrency, JSON conversion, eval gates, credentials and disposal. Generate the package README and error catalogue from their sources. Add executable documentation drift checks and attached, typechecked class examples.
- 19f9cff: In `@docture/eval`, aggregate precision, recall, F1, and status counts by normalized field path. Show the worst fields in verbose eval output.
- 19f9cff: Export an `@docture/eval` gate for minimum F1 and maximum priced cost. Add --max-cost-usd to docture eval and report all failed threshold reasons in its summary.

  Keep known billed usage and attempt history on exhausted extraction errors, including schema violations. Include paid failures in eval token totals and cost gates.

- dad34aa: Invalid options now raise `InvalidOptionError` with code `INVALID_OPTION` instead of `RangeError` or `TypeError`. It carries `option`, `expected` and `received`, and its hint names the accepted values. This covers `concurrency`, `maxRepairs`, `onRuleFailure`, `pagesPerRequest`, `maxEagerPages`, `maxPixels`, chunk budgets, OCR fallback thresholds, `pageWindows` sizes, email limits and empty Tesseract `languages`, which is now rejected when the loader is built. The CLI exits with code 2 for it.
- 4c9f2bb: Compose IBAN strings from caller-generated country and BBAN fields. Reuse field generators while the consuming schema owns its record shape and national formatting. Generate schema-validated structured pools for any JSON data model from seeded or model-backed sources. Structured pools validate cached raw inputs, preserve schema transformations, and support explicit offline reads.

  Declare captured data, helper revisions, and asset bytes as model or corpus dependencies. Their hashes affect corpus freshness and appear beside observed peer versions in corpus evidence. The synthetic CLI forwards configured corpus dependencies.

- 9fc9b6a: `page.image()` accepts a per-call signal as its second argument, `{ signal }`. An aborted call rejects with the signal's reason and cancels its render once no other caller waits for it; a cancelled render is not memoized. The vision strategy and `ImageSplitter` pass their signal, the OCR loaders honour it, and `NapiCanvasRasterizer` cancels the active PDF.js render task on abort. `docture review` and `docture inspect --render` stop rendering when the command is cancelled, and inspect reports the cancellation instead of a render error.
- 9fc9b6a: `docture review` now disposes the configured `loaders` it renders pages with when the config also supplies a built `converter` or `extractor`, and when the review fails before it starts, such as a missing input file or an unreadable schema. Before, a rendering loader's workers or engines could stay alive after the review finished or failed. Each configured loader is disposed once, including a loader the config also passes to its own converter or extractor.
- 9fc9b6a: Describe a fail-mode validation rule failure as a rule failure rather than a schema failure. `ContractViolationError` gains `failedCheck` (`"schema"` or `"rule"`), its message names the failed check, and the CLI gives a rule failure its own recovery hint.
- dad34aa: The HTTP service gives its clients hints that fit a service: a `TIMEOUT` points at the server's deadline instead of `--timeout`, and an unsupported file type points at the inspect route.
- 9fc9b6a: A path or `file:` URL that cannot be read now raises `UnsupportedSourceError` (`UNSUPPORTED_SOURCE`) instead of the raw file-system error. The message names the path and what to do: a missing file, a directory, and a file without read permission each get their own guidance, and `cause` keeps the original error with its `code`, such as `ENOENT`. The CLI reports these as `UNSUPPORTED_SOURCE` with a recovery hint instead of `INTERNAL`, and still exits 1.

## 0.2.0

### Minor Changes

- a490eef: Add deterministic PDF conversion to TXT, Markdown, and HTML, including normalized
  semantic layout, provenance, links, raster assets, constrained model assistance, and
  the `docture convert` command.

### Patch Changes

  - @docture/core@0.2.0
  - @docture/llm@0.2.0
  - @docture/loader-pdfjs@0.2.0
  - @docture/eval@0.0.3

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

  - @docture/core@0.1.0
  - @docture/llm@0.1.0
  - @docture/loader-pdfjs@0.1.0
  - @docture/eval@0.0.2
