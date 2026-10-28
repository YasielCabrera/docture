<p align="center">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7.0-3178c6.svg" />
<img alt="Node" src="https://img.shields.io/badge/Node-22%2B-5fa04e.svg" />
<img alt="AI SDK" src="https://img.shields.io/badge/AI%20SDK-7-000000.svg" />
<img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

# docture

docture extracts structured data from documents and converts PDFs to grounded TXT,
Markdown, HTML, or versioned JSON. You pick the PDF or OCR library and, when needed, the model.

## Features

- **Typed to the leaves**: `result.data` is inferred from your schema. No casts, no `any`.
- **Any schema library**: Zod, Valibot, ArkType, or any Standard Schema. Wrap plain JSON Schema with `jsonSchema()` from `ai`.
- **Any AI SDK model**: a provider instance, a gateway model string, or your own provider.
- **Pluggable loaders**: pdf.js, MuPDF, Tesseract, PaddleOCR. Select each engine through an explicit subpath.
- **Grounded conversion**: deterministic TXT, CommonMark, GFM tables, escaped HTML, and versioned JSON with page and box provenance.
- **Capabilities**: loader types retain capability literals. Document facts determine strategy eligibility at runtime, and capability-specific APIs reject incompatible loader types.
- **Classification**: each kind carries its own schema, so narrowing on `name` narrows `data`.
- **Splitting**: one PDF holding several unrelated documents comes back as one typed result each.
- **Explicit fallback**: strategies run in order, every attempt is recorded with its error.
- **Cost and accuracy**: token usage and USD per run, plus field-level scoring for CI.
- **Selected engines**: install only the engines your application uses. MuPDF and Tesseract use WASM. `@napi-rs/canvas` and `onnxruntime-node` install native prebuilds.

## Installation

```bash
npm install docture pdfjs-dist@6.2.108 ai@^7 @ai-sdk/openai zod@^4
```

`docture` exports core from its root. Import model features from `docture/llm` or a
narrow entry such as `docture/llm/text`, and adapters from `docture/loaders/*`. Engines
are optional peers that you install explicitly. The only other published package is
`@docture/cli`. Node.js 22 or newer is required.

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

const decided = await extractor
  .loadLlm(new LLM(openai("gpt-5")), { classify: true })
  .classify("unknown.pdf", [invoice, receipt] as const);

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

`TextSplitter` reads the pages; `ImageSplitter` looks at them, and declares
`RENDERABLE_PAGES`, so APIs that require renderable input reject a text-only loader.

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
import { errorCodeOf } from "docture";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadStrategy(myRegexParser)             // tried first, free and exact
  .loadLlm(new LLM(openai("gpt-5")));      // tried when it fails

const outcome = await extractor.safeExtract("invoice.pdf", Invoice);

if (!outcome.ok) {
  switch (errorCodeOf(outcome.error)) {    // typed codes, no string matching
    case "NO_ELIGIBLE_STRATEGY": break;
    case "CONTRACT_VIOLATION": break;
    case "TIMEOUT": break;
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
| `TIMEOUT` | A library-owned stage deadline elapsed. |
| `DUPLICATE_COMPONENT` | Two components use the same registered name. |
| `SPLIT_FAILED` | Splitting is unavailable or failed. |
| `UNCLASSIFIED_GROUP` | A split group matched none of the allowed kinds. |
| `MISSING_ENGINE` | A selected integration's optional engine is not installed. |
| `MISSING_COMPONENT` | Required wiring or call state is missing. |
<!-- docture-error-codes:end -->


### Accuracy

Field-level scoring, for a test or a CI gate:

```ts
import { formatFailures, scoreExtraction } from "docture/eval";

const score = scoreExtraction(expected, result.data);
expect(score.f1, formatFailures(score)).toBe(1);
```

### CLI

```bash
npm install --save-dev @docture/cli @ai-sdk/openai zod@^4
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

stdout is a versioned JSON envelope. Read extracted values with
`jq ".results[0].data.total"`. Diagnostics go to stderr:

```
✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041
```

`extract`, `convert`, `classify`, `inspect` (no model, no API key) and `eval`. See
[`@docture/cli`](packages/cli).

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

Only `docture` and `@docture/cli` are published. These are all supported library entries:

| Import | Exports or purpose |
| --- | --- |
| `docture` | Core contracts, `Extractor`, `DocumentConverter`, `Process`, errors, and custom components |
| `docture/llm` | `LLM`, `model`, and all model components and helpers |
| `docture/llm/text` | `LlmStrategy`, `LlmStrategyOptions`, `llm`, `modelIdOf` |
| `docture/llm/vision` | `VisionStrategy`, `vision`, and options |
| `docture/llm/classifier` | `LlmClassifier`, `llmClassifier`, and options |
| `docture/llm/layout` | `LlmLayoutAnalyzer`, `llmLayout`, and options |
| `docture/llm/split` | `TextSplitter`, `ImageSplitter`, factories, and options |
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
| `docture/raster/canvas` | `NapiCanvasRasterizer` |
| `docture/chunk` | Retrieval chunks with page, box, and source-id provenance |
| `docture/eval` | Field scoring, hallucination detection, and run reports |
| `docture/testing/doubles` | In-memory documents, loaders, and fixed or failing strategies |
| `docture/testing/conformance` | Loader and rasterizer contract suites |
| `docture/testing/fixtures` | Generated PDFs and their expected data |
| `@docture/cli` | CLI configuration, IO, errors, and `run` |

### Install selected peers

Core with its schema helper, custom components, or in-memory extraction:

```sh
npm install docture zod@^4
```

PDF.js deterministic extraction or conversion:

```sh
npm install docture pdfjs-dist@6.2.108 zod@^4
```

Any model capability with PDF.js and the OpenAI provider:

```sh
npm install docture pdfjs-dist@6.2.108 ai@^7 @ai-sdk/openai zod@^4
```

MuPDF text or rendering:

```sh
npm install docture mupdf@1.28.0 zod@^4
```

Tesseract image OCR:

```sh
npm install docture tesseract.js@7.0.0
```

PaddleOCR image OCR:

```sh
npm install docture ppu-paddle-ocr@6.3.0 onnxruntime-node@1.27.0
```

Both OCR loaders read multi-page TIFF. PaddleOCR also needs `utif2@4.1.0` for TIFF.

PDF OCR also needs a configured rasterizer. For the scanned-document example above,
which combines Tesseract, PDF.js, MuPDF rendering, and a model:

```sh
npm install docture tesseract.js@7.0.0 pdfjs-dist@6.2.108 mupdf@1.28.0 ai@^7 @ai-sdk/openai zod@^4
```

Canvas rendering, or vision with PDF.js and OpenAI:

```sh
npm install docture pdfjs-dist@6.2.108 @napi-rs/canvas@1.0.10 ai@^7 @ai-sdk/openai zod@^4
```

For rendering without a model, omit `ai` and the provider from that command.

Evaluation, test doubles, or the narrow cache, pricing, prompt, merge, and relaxation helpers:

```sh
npm install docture
```

Generated PDF fixtures:

```sh
npm install --save-dev docture pdfkit@0.19.1
```

Conformance suites generate PDFs and register Vitest tests, so they need both peers:

```sh
npm install --save-dev docture pdfkit@0.19.1 'vitest@>=3'
```

Also install the engine under test. Doubles need neither PDFKit nor Vitest.
All peers must satisfy their compatibility range when present, even for an adapter the
application does not import. The versions above are the ones Docture is developed with;
the [package reference](apps/docs/content/docs/reference/packages.mdx#engine-versions)
lists each supported range and the versions the release gate runs. If the application
already depends on another release of `tesseract.js`, `ppu-paddle-ocr`, or
`onnxruntime-node`, the installation recipes give an npm override for core use. A missing
engine raises `MissingEngineError` on first use. Model classification, layout, and
splitting accept Zod 3.25.76 or later 3.x, or Zod 4.1.8 or later; the core schema helper
also has a Zod peer.

`@docture/cli` requires AI SDK and PDF.js and attempts `@napi-rs/canvas` as its optional
default renderer. If optional dependencies were omitted, install canvas explicitly:

```sh
npm install --save-dev @docture/cli @napi-rs/canvas@1.0.10
```

MuPDF is AGPL-3.0-or-later licensed. Tesseract and MuPDF use WASM. ONNX Runtime and
canvas have platform-specific native dependencies. See the
[installation recipes](apps/docs/content/docs/guides/installation.mdx) for complete
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
`@docture/raster-canvas` with `docture/raster/canvas`, and `@docture/eval` with
`docture/eval`. Split `@docture/testing` imports across `/testing/doubles`,
`/testing/conformance`, and `/testing/fixtures`, each prefixed with `docture`.

The root no longer exports `LLM`, `llm`, splitters, or model utilities. For example:

```ts
import { contract } from "docture";
import { Extractor } from "docture/node";
import { LLM } from "docture/llm";
import { fileCache } from "docture/llm/cache";
```

Install the selected engines explicitly after removing their old scoped wrappers. See
the [migration guide](apps/docs/content/docs/guides/migration.mdx) for the complete mapping.

## Documentation

- **Docs site**: [`apps/docs`](apps/docs), Fumadocs on Next.js. `pnpm docs` → http://localhost:3100
- **Examples**: [`apps/examples`](apps/examples), runnable folders covering extraction and conversion, including offline paths.
- **Architecture**: [`packages/docture/ARCHITECTURE.md`](packages/docture/ARCHITECTURE.md) for the layering.

```bash
pnpm --filter @docture/examples run fetch    # ~2 MB, once
pnpm --filter @docture/examples quick-start  # the library in one screen
pnpm --filter @docture/examples offline      # run examples without an API key
```

The one worth opening is
[`06-fallback-routing-and-errors`](apps/examples/06-fallback-routing-and-errors): eleven
real layouts, two hand-written parsers, and a table of exactly which strategy answered
each document and what was tried before it.

## Why docture?

Most document-extraction libraries hand back a `Record<string, unknown>` and a promise
that the model probably got it right. This one is built around three ideas:

1. **The types are the contract.** `result.data` is inferred from your schema to its
   leaves. APIs with capability-specific loader types reject incompatible loaders.
2. **The model is yours.** Not a wrapper with its own provider list, its own version of
   the SDK and its own opinions about prompts. `ai` is a peer dependency.
3. **Explicit engines.** Each adapter has a named subpath and a declared engine peer.
   Swapping PDF.js for MuPDF changes the adapter import and selected engine.

## Contributing

```bash
pnpm install
pnpm check          # typecheck + test, everything
pnpm build
pnpm test           # or: pnpm --filter docture test
```

Toolchain: pnpm workspaces, Turborepo, TypeScript 7, Vitest 4, Changesets.

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

MIT. See [LICENSE](./LICENSE). `docture/loaders/mupdf` wraps AGPL-licensed `mupdf`.
