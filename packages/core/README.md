# @docture/core

The contracts, the pipeline, and the typed errors. Bring your own loader and your own model.

```sh
pnpm add @docture/core
```

Its only dependency is `@ai-sdk/provider-utils`. No PDF library, no WASM, no ONNX, not even
`ai`. Every heavy dependency lives in the package that wraps it, and
[a test asserts it](./test/architecture.test.ts).

```ts
import { Extractor } from "@docture/core";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { LLM } from "@docture/llm";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract("invoice.pdf", z.object({ total: z.number() }));
result.data.total; // number
```

`new Extractor({ loaders, strategies })` and `createExtractor(...)` build the same thing
from one object, for wiring that comes from a config file.

## What is here

**`Extractor`.** The composition root, fluent or declarative. It owns its components and
disposes them once. `extract` returns the envelope, `extractData` the fields alone,
`safeExtract` a discriminated union, `extractBatch` an async generator.

**`Process`.** A bundle of several documents: read once, cut, extract each. Returns a
discriminated union, so narrowing on `name` narrows `data`.

**`contract(...)`.** A schema that knows its own name, for prompts and reports. Optional
everywhere, since a bare schema always works.

**The plugin interfaces.** `DocumentLoader`, `Rasterizer`, `ExtractionStrategy`, `Classifier`,
`Splitter`. Each is a plain interface, and the `define*` helpers only pin literal types.

**`ModelBackend`.** How `loadLlm` accepts a model without core importing the AI SDK.

**`DocumentLoaderData`.** The one loader that lives here, because text is bytes plus a
`TextDecoder`. It makes core a working pipeline on its own.

**`CompletionStrategy`, `SplittingStrategy`, `ClassificationStrategy`.** The closed
vocabularies, as constants that ARE their string literals.

**`withRasterizer`.** Compose a reader with a renderer. The result's type gains
`images: true`.

**`linesFromWords`.** The shared word-to-line grouper every geometry loader needs.

**`imageSize`.** PNG and JPEG dimensions from the header, for an OCR loader handed a bare
image and no page size to report.

**Typed errors.** Each carries a literal `code`, so `switch` over them is exhaustive.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the layering, the invariants, and why
validation happens in exactly one place.

## Schemas

The contract type is the AI SDK's `FlexibleSchema`, so Zod, Valibot, ArkType and raw JSON
Schema all work and `result.data` is inferred from whichever you passed. We do not invent a
schema abstraction. Reusing that one means no adapter code and types that compose exactly
with `generateObject`.

## Errors

`extract()` throws. `safeExtract()` returns `{ ok, result } | { ok, error }`, the same pairing
as Zod's `parse` / `safeParse`.

| Code | Means |
|---|---|
| `NO_ELIGIBLE_LOADER` | nothing accepts this media type, so it is a wiring gap |
| `LOAD_FAILED` | every eligible loader threw |
| `NO_ELIGIBLE_STRATEGY` | the document loaded, but nothing wired can read it (carries `features`) |
| `EXTRACTION_FAILED` | every eligible strategy ran and threw (carries `attempts`) |
| `CONTRACT_VIOLATION` | a strategy produced data the schema rejects (carries `issues`) |
| `TIMEOUT` | one of our per-stage deadlines elapsed, retryable, unlike a caller's abort |
| `UNSUPPORTED_SOURCE` | the source could not be read at all |
| `DUPLICATE_COMPONENT` | two components registered under one name |
