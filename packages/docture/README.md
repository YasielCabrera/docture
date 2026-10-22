<p align="center">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7.0-3178c6.svg" />
<img alt="Node" src="https://img.shields.io/badge/Node-22%2B-5fa04e.svg" />
<img alt="AI SDK" src="https://img.shields.io/badge/AI%20SDK-7-000000.svg" />
<img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

# docture

docture extracts structured data from documents and converts PDFs to grounded TXT,
Markdown, or HTML. You pick the PDF or OCR library and, when needed, the model.

**TL;DR Document intelligence for TypeScript.**

## 🚀 Key Features

- **Typed to the leaves**: `result.data` is inferred from your schema. No casts, no `any`.
- **Any schema library**: Zod, Valibot, ArkType, or raw JSON Schema — whatever the AI SDK takes.
- **Any AI SDK model**: a provider instance, a gateway model string, or your own provider.
- **Pluggable loaders**: pdf.js, MuPDF, Tesseract, PaddleOCR. Each in its own package, each named after the library it wraps.
- **Grounded conversion**: deterministic TXT, CommonMark, GFM tables, and escaped HTML with page and box provenance.
- **Typed capabilities**: a strategy that needs page geometry will not accept a loader that cannot produce it. Compile error, not a runtime surprise on page 200.
- **Classification**: each kind carries its own schema, so narrowing on `name` narrows `data`.
- **Splitting**: one PDF holding several unrelated documents comes back as one typed result each.
- **Explicit fallback**: strategies run in order, every attempt is recorded with its error.
- **Cost and accuracy**: token usage and USD per run, plus field-level scoring for CI.
- **No native binaries**: WASM or prebuilt everywhere. `npm install` and go.

## 📦 Installation

```bash
npm install docture @docture/loader-pdfjs ai @ai-sdk/openai zod
```

`docture` is the facade — the pipeline, the contracts and the model seam through one
import. Loaders stay separate because they are the heavy dependencies and picking one is
a real decision. See [Packages](#-packages) for the pieces.

## 🛠️ Usage

### Basic Extraction

Define a contract, wire a loader and a model, extract:

```ts
import { Extractor, LLM, contract } from "docture";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
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

result.data.lineItems[0].amount; // number — inferred, no cast
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
decided.confidence; // 0–1
decided.signals;    // every classifier's verdict, including abstentions
```

### Splitting a Bundle

A scanned batch is routinely one PDF holding several unrelated documents. `Process`
answers "what documents are in this file, and what is in each of them?":

```ts
import { Process, SplittingStrategy, TextSplitter } from "docture";

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

The bundle is read once, however many documents come out of it. `split` is lazy — it
records the plan, and only `extract` is awaited. A group the classification list does not
cover is an error, not a silent skip.

`TextSplitter` reads the pages; `ImageSplitter` looks at them, and declares
`RENDERABLE_PAGES` — so handing it a text-only bundle fails at the wiring line rather than
on page 40.

### Scanned Documents

A scan has no text layer, so no text strategy is a candidate for it. Two ways out — OCR
it, or show it to a vision model:

```ts
import { withRasterizer } from "docture";
import { DocumentLoaderTesseract } from "@docture/loader-tesseract";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { MuPdfRasterizer } from "@docture/loader-mupdf";

// OCR: a loader like any other
new Extractor().loadDocumentLoader(new DocumentLoaderTesseract());

// Vision: compose a rasterizer onto the loader, then ask for the vision strategy
new Extractor()
  .loadDocumentLoader(withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer()))
  .loadLlm(new LLM(openai("gpt-5")), { vision: true });
```

Reading and rendering are separate plugins, so choosing an OCR engine does not also
choose how pages get rendered. Page images are lazy: `page.image()` renders that page and
memoizes it, so a 200-page document a strategy looks at two pages of costs two renders.

### Fallback and Errors

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
  switch (errorCodeOf(outcome.error)) {    // eleven literal codes, no string matching
    case "NO_ELIGIBLE_STRATEGY": break;
    case "CONTRACT_VIOLATION": break;
    case "TIMEOUT": break;
  }
}
```

`safeExtract` mirrors Zod's `parse` / `safeParse`. Nothing is silent: every attempt lands
in `result.attempts` with its error.

### Accuracy

Field-level scoring, for a test or a CI gate:

```ts
import { formatFailures, scoreExtraction } from "@docture/eval";

const score = scoreExtraction(expected, result.data);
expect(score.f1, formatFailures(score)).toBe(1);
```

### CLI

```bash
npx docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5
```

stdout is the data, so it pipes into `jq`. stderr is the story:

```
✓ invoice.pdf → llm via pdfjs · 2.1s · 3,412 tokens · $0.0041
```

`extract`, `classify`, `inspect` (no model, no API key) and `eval`. See
[`@docture/cli`](https://github.com/YasielCabrera/docture/tree/main/packages/cli).

## 🧩 Models

The model is the AI SDK's `LanguageModel`. `ai` is a peer dependency, so the model you
construct is the model that runs:

```ts
new LLM(openai("gpt-5"))
new LLM(anthropic("claude-opus-5"))
new LLM("openai/gpt-5")              // AI Gateway
new LLM(ollama("phi4"))              // or anything else with a provider
```

`@docture/core` does not depend on the AI SDK — a deterministic pipeline should not
install a model client, and [a test](https://github.com/YasielCabrera/docture/blob/main/packages/core/test/architecture.test.ts) enforces it.
So `loadLlm` takes a `ModelBackend`, and `LLM` is one. It knows how to turn itself into
the extraction strategy, the vision strategy, the classifier and the splitter, configured
once.

## ⚙️ How It Works

- **Document Loaders**: turn bytes into text, geometry and pages. One per library, named after it.
- **Rasterizers**: render pages to images. Composed onto a loader with `withRasterizer`.
- **Strategies**: turn a loaded document into data. A hand-written parser and an LLM call are the same shape.
- **Contracts**: a schema that knows its own name and description, so the model gets told what it is reading.
- **Classifications**: what kind of document this is, each carrying its own schema.
- **Splitters**: cut a bundle into its constituent documents.
- **Extractor**: routes one document through loaders and strategies, in declared order.
- **Process**: splits a file, then runs an `Extractor` over each document that comes out.

Every plugin is a plain object with no base class, produced by a `define*` helper. Writing
your own is implementing an interface, not extending a framework.

## 📦 Packages

| Package | What it is |
|---|---|
| [`docture`](https://github.com/YasielCabrera/docture/tree/main/packages/docture) | The facade: `core` + `llm` through one import. Start here. |
| [`@docture/core`](https://github.com/YasielCabrera/docture/tree/main/packages/core) | Contracts, pipeline, typed errors. Its only dependency is `@ai-sdk/provider-utils`. |
| [`@docture/llm`](https://github.com/YasielCabrera/docture/tree/main/packages/llm) | `LLM`, `LlmStrategy`, `VisionStrategy`, `LlmClassifier`, the splitters. |
| [`@docture/loader-pdfjs`](https://github.com/YasielCabrera/docture/tree/main/packages/loader-pdfjs) | `DocumentLoaderPdfJs` — text and geometry via `pdfjs-dist`. |
| [`@docture/loader-mupdf`](https://github.com/YasielCabrera/docture/tree/main/packages/loader-mupdf) | `DocumentLoaderMuPdf` and `MuPdfRasterizer` via `mupdf` (WASM). AGPL. |
| [`@docture/loader-tesseract`](https://github.com/YasielCabrera/docture/tree/main/packages/loader-tesseract) | `DocumentLoaderTesseract` — OCR via `tesseract.js` (WASM). |
| [`@docture/loader-paddleocr`](https://github.com/YasielCabrera/docture/tree/main/packages/loader-paddleocr) | `DocumentLoaderPaddleOcr` — OCR via PaddleOCR's ONNX models. |
| [`@docture/raster-canvas`](https://github.com/YasielCabrera/docture/tree/main/packages/raster-canvas) | `NapiCanvasRasterizer` — page rendering via `@napi-rs/canvas`. |
| [`@docture/eval`](https://github.com/YasielCabrera/docture/tree/main/packages/eval) | Field-level scoring, hallucination detection, cost reporting. |
| [`@docture/testing`](https://github.com/YasielCabrera/docture/tree/main/packages/testing) | Conformance suites, in-memory doubles, deterministic synthetic PDFs. |
| [`@docture/cli`](https://github.com/YasielCabrera/docture/tree/main/packages/cli) | `docture` — extract, classify, inspect and score from a terminal. |

Installing `core` pulls no PDF library, no WASM, no ONNX, not even `ai`. Every heavy
dependency lives in the package that wraps it.

Every loader package runs the same
[conformance suite](https://github.com/YasielCabrera/docture/blob/main/packages/testing/src/conformance/loader.ts) against its own class. All
four pass it — a text layer and an OCR pass held to the same invariants — which is what
makes them interchangeable in fact rather than in principle.

## 📚 Documentation

- **Docs site**: [`apps/docs`](https://github.com/YasielCabrera/docture/tree/main/apps/docs), Fumadocs on Next.js. `pnpm docs` → http://localhost:3100
- **Examples**: [`apps/examples`](https://github.com/YasielCabrera/docture/tree/main/apps/examples), sixteen runnable folders covering extraction and conversion. Twelve run with no API key.
- **Architecture**: [`packages/core/ARCHITECTURE.md`](https://github.com/YasielCabrera/docture/blob/main/packages/core/ARCHITECTURE.md) for the layering.

```bash
pnpm --filter @docture/examples fetch        # ~2 MB, once
pnpm --filter @docture/examples quick-start  # the library in one screen
pnpm --filter @docture/examples offline      # the eleven that run with no API key
```

The one worth opening is
[`06-fallback-routing-and-errors`](https://github.com/YasielCabrera/docture/tree/main/apps/examples/06-fallback-routing-and-errors): eleven
real layouts, two hand-written parsers, and a table of exactly which strategy answered
each document and what was tried before it.

## 📝 Why docture?

Most document-extraction libraries hand back a `Record<string, unknown>` and a promise
that the model probably got it right. This one is built around three ideas:

1. **The types are the contract.** `result.data` is inferred from your schema to its
   leaves, and a wiring mistake — a vision strategy on a loader that cannot render — is a
   compile error at the wiring line.
2. **The model is yours.** Not a wrapper with its own provider list, its own version of
   the SDK and its own opinions about prompts. `ai` is a peer dependency.
3. **One library per package, named after the library.** No `pdfTextLayer()` hiding a
   choice you did not make. Swapping pdf.js for MuPDF is swapping an import.

## 🤝 Contributing

```bash
pnpm install
pnpm check          # typecheck + test, everything
pnpm build
pnpm test           # or: pnpm --filter @docture/core test
```

Toolchain: pnpm workspaces, Turborepo, TypeScript 7, Vitest 4, Changesets.

Adding a loader for another library is three steps:

1. `packages/loader-<library>/`, with a class named after the library.
2. Implement `DocumentLoader` — a plain object, no base class.
3. Point the conformance suite at it:

```ts
describeLoaderConformance({ name: "DocumentLoaderMuPdf", create: () => new DocumentLoaderMuPdf() });
```

Fixtures are generated, not committed: `makeInvoicePdf({ seed })` produces a real PDF and
its ground truth from the same values, so expected output cannot drift from the bytes and
a corpus needs nothing confidential.

## 📄 License

MIT — see [LICENSE](https://github.com/YasielCabrera/docture/blob/main/LICENSE).
`@docture/loader-mupdf` wraps AGPL-licensed `mupdf` — see that package's README.
