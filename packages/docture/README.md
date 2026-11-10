<p align="center">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7.0-3178c6.svg" />
<img alt="Node" src="https://img.shields.io/badge/Node-22%2B-5fa04e.svg" />
<img alt="AI SDK" src="https://img.shields.io/badge/AI%20SDK-7-000000.svg" />
<img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

# docture

docture extracts structured data from documents and converts PDFs to grounded TXT,
Markdown, HTML, or versioned JSON. You pick the PDF or OCR library and, when needed, the model.
It also generates labeled synthetic documents from your schema, so you can measure an
extraction pipeline before you have a hand-labeled corpus.

[Documentation](https://docture.vercel.app/docs) ·
[For agents](https://docture.vercel.app/docs/getting-started/ai-agents)

## Features

- **Typed to the leaves**: `result.data` is inferred from your schema. No casts, no `any`.
- **Any schema library**: Zod, Valibot, ArkType, or any Standard Schema. Wrap plain JSON Schema with `jsonSchema()` from `ai`.
- **Any AI SDK model**: a provider instance, a gateway model string, or your own provider.
- **Pluggable loaders**: pdf.js, MuPDF, Tesseract, PaddleOCR. Select each engine through an explicit subpath.
- **Grounded conversion**: deterministic TXT, CommonMark, GFM tables, escaped HTML, and versioned JSON with page and box provenance.
- **Capabilities**: loader types retain capability literals, so `withRasterizer` marks a loader as rendering pages and `createCheckedExtractor` rejects literal wiring whose strategies need a capability no loader declares. Document facts decide strategy eligibility at runtime, and an ineligible document fails with an error that names the fix, such as wrapping the loader with `withRasterizer(loader, rasterizer)`.
- **Classification**: each kind carries its own schema, so narrowing on `name` narrows `data`.
- **Splitting**: one PDF holding several unrelated documents comes back as one typed result each.
- **Explicit fallback**: strategies run in order, every attempt is recorded with its error.
- **Cost and accuracy**: token usage and USD per run, plus field-level scoring for CI.
- **Synthetic corpora**: seeded documents from your schema, with every printed value's page and box, verified against the PDF and carried through scan, photo, and fax degradations.
- **Selected engines**: install only the engines your application uses. MuPDF and Tesseract use WASM. `@napi-rs/canvas` and `onnxruntime-node` install native prebuilds.

## Installation

```bash
npm install docture pdfjs-dist ai @ai-sdk/openai zod
```

`docture` exports core from its root. Import model features from `docture/llm` or a
narrow entry such as `docture/llm/text`, and adapters from `docture/loaders/*`. Engines
are optional peers that you install explicitly. The other published packages are `@docture/cli`, `@docture/eval`, and
`@docture/synthetic`. Node.js 22 or newer is required.

## Usage

### Basic extraction

Define a contract, wire a loader and a model, extract:

```ts
import { contract } from "docture";
import { Extractor } from "docture/node";
import { LLM } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const Invoice = contract({
  name: "invoice",
  description: "A commercial invoice with a total and line items.",
  schema: z.object({
    invoiceNumber: z.string().describe("The invoice number, top-right"),
    issuedAt: z.string().describe("Issue date, ISO 8601"),
    total: z.number(),
    lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
  }),
});

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract("invoice.pdf", Invoice);

result.data.lineItems[0].amount; // number, inferred from the schema
result.method;                   // which strategy answered
result.attempts;                 // everything tried, in order, with its error
result.usage.costUsd;
```

`costUsd` requires a matching pricing table for model calls. Response-cache hits do not add a new charge.

`extract` returns the envelope because "which strategy answered and what did it cost" are
the questions you ask when a number looks wrong. When you only want the fields:

```ts
const invoice = await extractor.extractData("invoice.pdf", Invoice);
invoice.total; // number
```

### Document conversion

Convert a digital PDF without a schema or model:

```ts
import { DocumentConverter } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

const converter = new DocumentConverter()
  .loadDocumentLoader(new DocumentLoaderPdfJs());

const converted = await converter.convert("report.pdf", {
  format: "markdown",
  assets: "referenced",
});

converted.content;
converted.pages;
converted.assets;
```

TXT joins pages with form feeds. Markdown includes invisible page markers and GFM
tables. HTML is a complete escaped document with page-numbered sections. A scanned PDF
needs an explicitly configured OCR loader.

### Classification

Decide what a document is before extracting it. `name` comes back as a literal union of
the candidates you passed, so a `switch` over it is exhaustive:

```ts
import { defineClassification } from "docture";

const invoice = defineClassification({
  name: "invoice",
  description: "A vendor billing a customer for itemised goods.",
  schema: Invoice.schema,
});

const receipt = defineClassification({
  name: "receipt",
  description: "A point-of-sale receipt with a merchant and a total.",
  schema: Receipt.schema,
});

// One loadLlm call registers the model's extraction strategy and its classifier.
const classifying = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")), { classify: true });

const decided = await classifying.classify("unknown.pdf", [invoice, receipt] as const);

decided.name;       // "invoice" | "receipt" | "UNKNOWN"
decided.confidence; // 0-1
decided.signals;    // every classifier's verdict, including abstentions
```

### Splitting a bundle

A scanned batch is routinely one PDF holding several unrelated documents. `Process`
answers "what documents are in this file, and what is in each of them?":

```ts
import { SplittingStrategy } from "docture";
import { Process } from "docture/node";
import { TextSplitter } from "docture/llm/split";

const documents = await new Process()
  .loadSplitter(new TextSplitter({ model: openai("gpt-5") }))
  .loadExtractor(extractor)
  .loadFile("batch.pdf")
  .split([invoice, receipt], SplittingStrategy.EAGER)
  .extract();

for (const d of documents) {
  d.pages;                                       // which pages of the bundle it was
  if (d.name === "invoice") d.data.invoiceNumber; // narrowed
  else                      d.data.merchantName;  // narrowed
}
```

The bundle is read once, however many documents come out of it. `split` is lazy: it
records the plan, and only `extract` is awaited. A group the classification list does not
cover is an error, not a silent skip.

`Process` borrows the extractor passed to `loadExtractor()`; dispose it yourself after its last use.

`TextSplitter` reads the pages; `ImageSplitter` looks at them, and declares
`RENDERABLE_PAGES`. With a text-only loader, `split` fails with `SPLIT_FAILED` and tells
you to compose the loader with `withRasterizer(loader, rasterizer)`.

### Scanned documents

A scan has no text layer. Run OCR or send rendered pages to a vision model:

```ts
import { withRasterizer } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { MuPdfRasterizer } from "docture/loaders/mupdf";

// OCR: a loader like any other
new Extractor().loadDocumentLoader(new DocumentLoaderTesseract({
  rasterizer: new MuPdfRasterizer(),
}));

// Vision: compose a rasterizer onto the loader, then ask for the vision strategy
new Extractor()
  .loadDocumentLoader(withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer()))
  .loadLlm(new LLM(openai("gpt-5")), { vision: true });
```

Reading and rendering are separate plugins, so choosing an OCR engine does not also
choose how pages get rendered. Page images are lazy: `page.image()` renders that page and
memoizes it, so a 200-page document a strategy looks at two pages of costs two renders.

### Fallback and errors

Strategies run in the order you declared them and the first that does not throw wins. Put
a deterministic parser in front of the model and it answers for free when it can:

```ts
import { errorCodeOf, isDoctureError } from "docture";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadStrategy(myRegexParser)                // tried first, free and exact
  .loadLlm(new LLM(openai("gpt-5-mini")))     // strategy "gpt-5-mini"
  .loadLlm(new LLM(openai("gpt-5")));         // strategy "gpt-5", tried last

const outcome = await extractor.safeExtract("invoice.pdf", Invoice);

if (!outcome.ok) {
  switch (errorCodeOf(outcome.error)) {       // typed codes: a typo does not compile
    case "NO_ELIGIBLE_STRATEGY": break;
    case "CONTRACT_VIOLATION": break;
    case "TIMEOUT": break;
  }
  if (isDoctureError(outcome.error, "CONTRACT_VIOLATION")) {
    outcome.error.issues;                     // narrowed, no cast
  }
  if (isDoctureError(outcome.error)) {
    outcome.error.hint;                       // the next thing to try
  }
}
```

`safeExtract` mirrors Zod's `parse` / `safeParse`. Nothing is silent: every attempt lands
in `result.attempts` with its error.

### Error codes

<!-- docture-error-codes:start -->
| Code | Meaning |
| --- | --- |
| `NO_ELIGIBLE_LOADER` | No registered loader accepts the input media type. |
| `LOAD_FAILED` | Every eligible loader failed. |
| `NO_CONVERTIBLE_CONTENT` | The loaded document contains no convertible text. |
| `NO_ELIGIBLE_STRATEGY` | No strategy meets the loaded document's capabilities. |
| `EXTRACTION_FAILED` | Every eligible extraction strategy failed. |
| `PAGE_OUT_OF_RANGE` | The page selection is empty or includes unavailable pages. |
| `MODEL_OUTPUT_FAILED` | A billed model response failed structured-output validation. |
| `CONTRACT_VIOLATION` | Extracted data failed the requested schema or a fail-mode validation rule. |
| `UNSUPPORTED_SOURCE` | The source cannot be read. |
| `TIMEOUT` | A library-owned deadline elapsed: a stage's `stageTimeoutMs` or the whole call's `timeoutMs`. |
| `DUPLICATE_COMPONENT` | Two components use the same registered name. |
| `SPLIT_FAILED` | Splitting is unavailable or failed. |
| `UNCLASSIFIED_GROUP` | A split group matched none of the allowed kinds. |
| `MISSING_ENGINE` | A selected integration's optional engine is not installed. |
| `MISSING_COMPONENT` | Required wiring or call state is missing. |
| `DISPOSED` | A component was used after `dispose()` released it. |
| `INVALID_OPTION` | An option or argument is outside the values it accepts. |
| `DOCLING_FAILED` | Docling Serve rejected the request or returned no usable conversion. Raised by `docture/loaders/docling`. |
| `DOCX_FAILED` | Mammoth could not read the DOCX file. Raised by `docture/loaders/mammoth`. |
| `EMAIL_INVALID` | The input is not a readable RFC email or exceeds a configured limit. Raised by `docture/inputs/email`. |
| `EVAL_SPEC_INVALID` | An eval spec, rule set or metric set cannot be resolved. Raised by `@docture/eval`. |
| `GROUND_TRUTH_INVALID` | Expected values do not satisfy their eval spec. Raised by `@docture/eval`. |
| `EVAL_DATASET_INVALID` | An eval dataset cannot produce its cases. Raised by `@docture/eval`. |
| `EVAL_RUN_STORE_FAILED` | A stored eval run or result cannot be read or written. Raised by `@docture/eval`. |
| `OUT_OF_SCOPE` | An eval processor declined a case; the run records a skip. Raised by `@docture/eval`. |
| `MIGRATION_GUARD_FAILED` | A ground-truth migration changed paths outside its targets or is not idempotent. Raised by `@docture/eval`. |
| `EVAL_RUNS_INCOMPARABLE` | Two eval runs cannot be paired for comparison. Raised by `@docture/eval`. |
| `EVAL_PREFLIGHT_FAILED` | An eval experiment failed its preflight check before any case ran. Raised by `@docture/eval`. |
| `SYNTHESIS_FAILED` | A synthetic model cannot sample a value that satisfies its schema, constraints and scenario. Raised by `@docture/synthetic`. |
| `TEMPLATE_INVALID` | A synthetic template draws an undeclared field, skips a printed one or uses a glyph its font lacks. Raised by `@docture/synthetic`. |
| `LABEL_VERIFICATION_FAILED` | A rendered synthetic document does not show a labeled value inside its labeled box. Raised by `@docture/synthetic`. |
<!-- docture-error-codes:end -->


### Accuracy

Field-level scoring, datasets, run comparison and CI gates live in
[`@docture/eval`](https://github.com/YasielCabrera/docture/tree/main/packages/eval):

```ts
import { looseEval } from "@docture/eval";

const score = looseEval().score(expected, result.data);
expect(score.metrics.f1).toBe(1);
```

### Synthetic documents

[`@docture/synthetic`](https://github.com/YasielCabrera/docture/tree/main/packages/synthetic) samples values from your schema, draws them with
your templates, and records the page and box of every printed field. `writeCorpus` adds
scan and photo renditions with the boxes moved through the same warp, and writes a
manifest that `@docture/eval` scores directly:

```ts
import { defineModel, gen } from "@docture/synthetic";
import { digital, scan, writeCorpus } from "@docture/synthetic/node";

const model = defineModel(Invoice, { fields: { invoiceNumber: gen.pattern("INV-######") } });
await writeCorpus("corpus", { model, templates: [classic], seeds: [1, 2, 3], renditions: [digital(), scan({ severity: 0.3 })] });
```

See [synthetic corpus example](https://github.com/YasielCabrera/docture/tree/main/apps/examples/synthetic-corpus) and the
[synthetic corpus guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/synthetic/quick-start.mdx).

### CLI

```bash
npm install --save-dev @docture/cli @ai-sdk/openai zod
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

stdout is a versioned JSON envelope. Read extracted values with
`jq ".results[0].data.total"`. Diagnostics go to stderr:

```
✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041
```

`extract`, `convert`, `classify`, `inspect` (no model, no API key) and `eval`. See
[`@docture/cli`](https://github.com/YasielCabrera/docture/tree/main/packages/cli).

## Models

The model is the AI SDK's `LanguageModel`. `ai` is a peer dependency, so the model you
construct is the model that runs:

```ts
new LLM(openai("gpt-5"))
new LLM(anthropic("claude-opus-5"))
new LLM("openai/gpt-5")              // AI Gateway
new LLM(ollama("phi4"))              // or anything else with a provider
```

The root `docture` entry does not import the AI SDK runtime or a PDF, OCR, or rendering
engine. Its normal dependencies include `@ai-sdk/provider-utils` for schema helpers
and `@types/json-schema` for declarations. `parse5`, `htmlparser2`, and `entities`
parse HTML/XHTML on demand, without optional engines or resource downloads.
The schema helper has a Zod peer. Model integrations use optional `ai@^7` and Zod peers; Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later, satisfies both.
`loadLlm` accepts the core `ModelBackend` interface, implemented by `LLM`. The backend
creates text, vision, classification, splitting, and layout components from one configuration.
Their names derive from the model id (`gpt-5`, `gpt-5:vision`, `gpt-5:classifier`), so two
models form a fallback chain. To wire the same model twice, give one a distinct `{ name }`.
An options object takes the same model: `new Extractor({ loaders, llm: { backend, vision: true } })`.

## How it works

- **Document Loaders**: turn bytes into text, geometry and pages. One per library, named after it.
- **Rasterizers**: render pages to images. Composed onto a loader with `withRasterizer`.
- **Strategies**: turn a loaded document into data. A hand-written parser and an LLM call are the same shape.
- **Contracts**: a schema that knows its own name and description, so the model gets told what it is reading.
- **Classifications**: what kind of document this is, each carrying its own schema.
- **Splitters**: cut a bundle into its constituent documents.
- **Extractor**: routes one document through loaders and strategies, in declared order.
- **DocumentConverter**: normalizes text, layout, links, and raster figures, then exports TXT, Markdown, HTML, or versioned JSON.
- **Process**: splits a file, then runs an `Extractor` over each document that comes out.

Every plugin is a plain object with no base class, produced by a `define*` helper. Writing
your own is implementing an interface, not extending a framework.

## Packages and imports

Only `docture`, `@docture/cli`, `@docture/eval`, and `@docture/synthetic` are published. The table lists runtime entries, selected eval entries, and every synthetic entry. See the [complete eval entry table](https://github.com/YasielCabrera/docture/blob/main/packages/eval/README.md#entry-points) for all 22 eval entries:

| Import | Exports or purpose |
| --- | --- |
| `docture` | Core contracts, `Extractor`, `DocumentConverter`, `Process`, errors, and custom components |
| `docture/docs/manifest.json` | Data asset locating offline guides, exact documented versions, and content hashes |
| `docture/node` | The core API with local file paths and file URLs: `Extractor`, `DocumentConverter`, `Process`, `resolveNodeSource` |
| `docture/llm` | `LLM`, `model`, and all model components and helpers |
| `docture/llm/text` | `LlmStrategy`, `LlmStrategyOptions`, `llm`, `modelIdOf` |
| `docture/llm/vision` | `VisionStrategy`, `vision`, and options |
| `docture/llm/classifier` | `LlmClassifier`, `llmClassifier`, and options |
| `docture/llm/layout` | `LlmLayoutAnalyzer`, `llmLayout`, and options |
| `docture/llm/split` | `TextSplitter`, `ImageSplitter`, factories, and options |
| `docture/llm/ocr` | `LlmOcrLoader`, `llmOcr`: a vision model as an OCR loader |
| `docture/llm/tool` | `extractTool`: an extractor as an AI SDK tool |
| `docture/llm/extractor` | `createLlmExtractor` and options |
| `docture/llm/cache` | Memory and file caches, fingerprints, and cache keys |
| `docture/llm/pricing` | Token accounting and prices |
| `docture/llm/prompt` | Prompts, chunks, and token estimates |
| `docture/llm/merge` | Partial result merging |
| `docture/llm/relax` | Partial JSON Schema preparation |
| `docture/loaders/pdfjs` | `DocumentLoaderPdfJs` |
| `docture/loaders/mupdf` | `DocumentLoaderMuPdf`, `MuPdfRasterizer` |
| `docture/loaders/tesseract` | `DocumentLoaderTesseract` |
| `docture/loaders/paddleocr` | `DocumentLoaderPaddleOcr` |
| `docture/loaders/mammoth` | `DocumentLoaderMammoth` for DOCX |
| `docture/loaders/docling` | `DocumentLoaderDoclingServe`, `DoclingServeClient` for a Docling Serve instance |
| `docture/import/docling` | `importDoclingDocument`: a DoclingDocument as a Docture document |
| `docture/inputs/email` | `expandEmail`: an email and its attachments as sources |
| `docture/sources/paperless` | `PaperlessSource`, `paperlessSource`: documents from Paperless-ngx |
| `docture/sinks/paperless` | `PaperlessSink`, `paperlessSink`: write extraction results back to Paperless-ngx |
| `docture/raster/canvas` | `NapiCanvasRasterizer` |
| `docture/chunk` | Retrieval chunks with page, box, and source-id provenance |
| `@docture/eval` | Specs, field scoring, metrics, result format, and gates |
| `@docture/eval/runner` | Dataset execution, experiments, resume, and re-scoring |
| `@docture/eval/node` | File datasets and result history |
| `@docture/eval/reporters/html` | Offline HTML reports |
| `@docture/synthetic` | Synthetic data models, generators, constraints, scenarios, printed masks, and templates |
| `@docture/synthetic/pdfkit` | `renderPdf`: templates to PDF with field boxes |
| `@docture/synthetic/verify` | `verifyLabels`, `assertVerified` |
| `@docture/synthetic/degrade` | `degrade`: scan, photo, and fax renditions with transformed boxes |
| `@docture/synthetic/node` | `writeCorpus`: resumable corpora for `@docture/eval` |
| `@docture/synthetic/faker` | `fakerFor`: seeded Faker values |
| `@docture/synthetic/react-pdf` | `defineReactTemplate`, `renderReactPdf`: React templates with field boxes |
| `@docture/synthetic/html` | `renderHtmlPdf`: HTML templates printed by Chromium |
| `@docture/synthetic/llm` | `llmTextPool`: cached model-written text pools |
| `docture/testing/doubles` | In-memory documents, loaders, and fixed or failing strategies |
| `docture/testing/conformance` | Loader and rasterizer contract suites |
| `docture/testing/fixtures` | Generated PDFs and their expected data |
| `docture/testing/llm` | `mockLayoutModel`, `mockOcrModel`: deterministic model doubles |
| `@docture/cli` | CLI configuration, IO, errors, and `run` |

### Install selected peers

Core with its schema helper, custom components, or in-memory extraction:

```sh
npm install docture zod
```

PDF.js deterministic extraction or conversion:

```sh
npm install docture pdfjs-dist zod
```

Any model capability with PDF.js and the OpenAI provider:

```sh
npm install docture pdfjs-dist ai @ai-sdk/openai zod
```

MuPDF text or rendering:

```sh
npm install docture mupdf zod
```

Tesseract image OCR:

```sh
npm install docture tesseract.js
```

PaddleOCR image OCR:

```sh
npm install docture ppu-paddle-ocr onnxruntime-node
```

Both OCR loaders read multi-page TIFF. PaddleOCR also needs `utif2@4.1.0` for TIFF.

PDF OCR also needs a configured rasterizer. For the scanned-document example above,
which combines Tesseract, PDF.js, MuPDF rendering, and a model:

```sh
npm install docture tesseract.js pdfjs-dist mupdf ai @ai-sdk/openai zod
```

Canvas rendering, or vision with PDF.js and OpenAI:

```sh
npm install docture pdfjs-dist @napi-rs/canvas ai @ai-sdk/openai zod
```

For rendering without a model, omit `ai` and the provider from that command.

Evaluation, test doubles, or the narrow cache, pricing, prompt, merge, and relaxation helpers:

```sh
npm install docture
```

Generated PDF fixtures:

```sh
npm install --save-dev docture pdfkit
```

Conformance suites generate PDFs and register Vitest tests, so they need both peers:

```sh
npm install --save-dev docture pdfkit vitest
```

Also install the engine under test. Doubles need neither PDFKit nor Vitest.

Synthetic documents: rendering, label verification, and scan or photo renditions:

```sh
npm install --save-dev @docture/synthetic docture pdfkit pdfjs-dist @napi-rs/canvas sharp
```
All peers must satisfy their compatibility range when present, even for an adapter the
application does not import. The versions above are the ones Docture is developed with;
the [package reference](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/getting-started/reference/packages.mdx#engine-versions)
lists each supported range and the versions the release gate runs. If the application
already depends on another release of `tesseract.js`, `ppu-paddle-ocr`, or
`onnxruntime-node`, the installation recipes give an npm override for core use. A missing
engine raises `MissingEngineError` on first use. Model classification, layout, and
splitting accept Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later; the core schema helper
also has a Zod peer.

`@docture/cli` requires AI SDK and PDF.js and attempts `@napi-rs/canvas` as its optional
default renderer. If optional dependencies were omitted, install canvas explicitly:

```sh
npm install --save-dev @docture/cli @napi-rs/canvas
```

MuPDF is AGPL-3.0-or-later licensed. Tesseract and MuPDF use WASM. ONNX Runtime and
canvas have platform-specific native dependencies. See the
[installation recipes](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/getting-started/installation.mdx) for complete
commands for each input and provider.

### Bundling and installation

All Docture wrapper files ship in one tarball. Optional peers isolate engine installs.
The library emits narrow ESM modules with `sideEffects: false`, so production bundlers
can remove unrelated modules. Use `llm()` from `docture/llm/text` for text-only extraction.

A used convenience class retains the implementations its methods reference. `LLM` can
create text, vision, classification, layout, and split components. No universal guarantee
removes unused class methods or runtime branches. Unbundled Node.js execution and
externalized dependencies are not tree-shaken.

### Breaking import migration

Replace the removed `@docture/core` import with `docture`, `@docture/llm` with
`docture/llm` or a narrow model entry, `@docture/loader-*` with `docture/loaders/*`,
and `@docture/raster-canvas` with `docture/raster/canvas`. Split `@docture/testing` imports
across `/testing/doubles`, `/testing/conformance`, and `/testing/fixtures`, each prefixed
with `docture`. `docture/eval` is removed. Import evaluation from `@docture/eval` and
`checkConversion` from `@docture/eval/conversion`.

The root no longer exports `LLM`, `llm`, splitters, or model utilities. For example:

```ts
import { contract } from "docture";
import { Extractor } from "docture/node";
import { LLM } from "docture/llm";
import { fileCache } from "docture/llm/cache";
```

Install the selected engines explicitly after removing their old scoped wrappers. See
the [migration guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/resources/migration.mdx) for the complete mapping.

## Documentation

The `docture` npm package includes the complete Markdown documentation for all four
packages under `node_modules/docture/docs/`. Start with `llms-tasks.txt`, use
`llms.txt` to find individual pages, or look up APIs in `api-symbols.json`.
Links between the bundled pages work offline.

Resolve the installed documentation from the workspace package that uses Docture:

```sh
node --input-type=module -e 'console.log(import.meta.resolve("docture/docs/manifest.json"))'
```

Read files relative to that manifest. Its `packages` field lists the exact versions
documented for `docture`, `@docture/cli`, `@docture/eval`, and `@docture/synthetic`.
Compare them with installed versions when using compatible but different releases.
The scoped packages' `AGENTS.md` files explain how to resolve their own dependency
copy under npm and pnpm.

For agents, add this instruction to your application's own `AGENTS.md`:

```text
Before changing Docture code, read the installed docture/AGENTS.md and its
docs/llms-tasks.txt. Resolve docture from the workspace package being edited,
check docs/manifest.json for the documented versions, and read the relevant guides.
```

- **Documentation**: [guides and API reference](https://docture.vercel.app/docs), with [agent setup](https://docture.vercel.app/docs/getting-started/ai-agents) for installed docs and Markdown access.
- **Docs development**: [`apps/docs`](https://github.com/YasielCabrera/docture/tree/main/apps/docs), Fumadocs on Next.js. Run `pnpm docs` and open http://localhost:3100.
- **Examples**: [`apps/examples`](https://github.com/YasielCabrera/docture/tree/main/apps/examples), runnable folders covering extraction and conversion, including offline paths.
- **Architecture**: [`packages/docture/ARCHITECTURE.md`](https://github.com/YasielCabrera/docture/blob/main/packages/docture/ARCHITECTURE.md) for the layering.

```bash
pnpm --filter @docture/examples quick-start  # extract from the bundled invoice
pnpm --filter @docture/examples offline      # run examples without an API key
```

Start with [`quick-start`](https://github.com/YasielCabrera/docture/tree/main/apps/examples/quick-start). Each example keeps its input
documents beside the code. The [fallback example](https://github.com/YasielCabrera/docture/tree/main/apps/examples/fallback-routing-and-errors)
uses two invoice layouts to show strategy selection and failure handling.

## Why docture?

Most document-extraction libraries hand back a `Record<string, unknown>` and a promise
that the model probably got it right. This one is built around three ideas:

1. **The types are the contract.** `result.data` is inferred from your schema to its
   leaves. `createCheckedExtractor` rejects a loader that lacks a capability at compile
   time; other wiring reports the missing capability at run time and names the fix.
2. **The model is yours.** Not a wrapper with its own provider list, its own version of
   the SDK and its own opinions about prompts. `ai` is a peer dependency.
3. **Explicit engines.** Each adapter has a named subpath and a declared engine peer.
   Swapping PDF.js for MuPDF changes the adapter import and selected engine.

## Contributing

```bash
pnpm install
pnpm check          # typecheck + test, everything
SITE_URL=https://docs.example pnpm build
pnpm test           # or: pnpm --filter docture test
```

Toolchain: pnpm workspaces, Turborepo, TypeScript 7, Vitest 4.

The four packages share one version. Record each user-facing change under
`## Unreleased` in the changed package's `CHANGELOG.md`: breaking changes and new
features under `### Minor Changes`, everything else under `### Patch Changes`.

To release, run the **Release packages** workflow from `main`. Versions stay below
1.0.0. With `bump` set to `auto`, the default, the release is a minor one when any
`Unreleased` section has a `### Minor Changes` heading and a patch one otherwise.
Choose `minor` or `patch` to override that.
The workflow sets the version in the four packages, renames each `Unreleased`
section to that version, and runs the lint, typecheck, test, build, and packed
package gates. With `publish` off it stops after a staging dry run and pushes
nothing. With `publish` on it pushes the version commit and the
`docture@<version>` tag, stages on npm the tarballs that the packed package gate
verified, and creates the GitHub release. If a run fails after the push, run it again with `bump` set to `none`;
packages already published or staged are skipped.

A staged version is not public yet. Approve each one under **Staged Packages** on
npmjs.com, or with `npm stage approve <stage-id>`; npm asks for two-factor
authentication. The workflow authenticates with the `NPM_TOKEN` secret of the `npm`
environment, a granular token with read and write access to `docture` and the
`@docture` scope.

The workspace build includes the documentation site. Outside Vercel, set `SITE_URL`
to its absolute origin so the production sitemap contains canonical URLs. See the
[documentation app guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/README.md) for local development and build settings.

`pnpm --filter docture build` also generates the installed documentation without
building the site. `pnpm docs:bundle` regenerates only the documentation.
Packing `docture` refreshes the documentation snapshot. Publication checks that no
changelog has an `Unreleased` section and that the source checkout is clean with a
known revision. Development builds and packs retain their `unreleased`
status. `pnpm release` validates the bundled documentation before publishing the
npm packages.
The library build is uncached so its source revision is refreshed; Turbo still tracks
the documentation inputs for downstream tasks.

Adding a loader for another library is three steps:

1. Add `packages/docture/src/loaders/<library>/`, with a class named after the library.
2. Implement `DocumentLoader` as a plain object.
3. Export its public subpath and run the conformance suite:

```ts
import { describeLoaderConformance } from "docture/testing/conformance";

describeLoaderConformance({ name: "DocumentLoaderMuPdf", create: () => new DocumentLoaderMuPdf() });
```

Fixtures are generated, not committed: `makeInvoicePdf({ seed })` produces a real PDF and
its ground truth from the same values, so expected output cannot drift from the bytes and
a corpus needs nothing confidential.

## License

MIT. See [LICENSE](https://github.com/YasielCabrera/docture/blob/main/LICENSE). `docture/loaders/mupdf` wraps AGPL-licensed `mupdf`.
