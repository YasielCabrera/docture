# @docture/llm

Structured extraction through **any AI SDK model**.

```sh
pnpm add @docture/llm ai
```

`ai` is a peer dependency, so there is exactly one copy of the model types in your tree and the
model you construct is the model that runs.

```ts
import { LLM } from "@docture/llm";
import { openai } from "@ai-sdk/openai";

new LLM(openai("gpt-5"))             // a provider instance
new LLM(anthropic("claude-opus-5"))  // a different provider
new LLM("openai/gpt-5")              // an AI Gateway model string
```

`LLM` is the `ModelBackend` that `extractor.loadLlm(...)` takes. `@docture/core` does not
depend on the AI SDK, because a deterministic pipeline should not install a model client.
So a model reaches core as something that knows how to turn itself into strategies.

```ts
const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5"), { pricing }), { vision: true, classify: true });
```

Configure it once and every strategy it produces inherits the cache, the pricing table
and the instructions.

Your schema reaches `generateObject` in its original form. Zod stays Zod, so refinements
and descriptions get to the provider instead of surviving a round trip through JSON Schema.

## What is here

| | |
|---|---|
| `LLM` | a model, and everything it can be turned into, which is what `loadLlm` takes |
| `llm(…)` / `LlmStrategy` | extract from the document's text |
| `vision(…)` / `VisionStrategy` | extract from page images, which is what reads a scan |
| `llmClassifier(…)` / `LlmClassifier` | decide the document kind from a cheap text excerpt |
| `TextSplitter` | cut a bundle by reading the page text |
| `ImageSplitter` | cut a bundle by looking at the pages, so it needs a rasterizer |
| `createLlmExtractor(…)` | the terse wiring for the common case |

```ts
const extractor = createLlmExtractor({
  loaders: [new DocumentLoaderPdfJs()],
  model: openai("gpt-5"),
  before: [myDeterministicParser],   // tried first, since a parser that works costs nothing
});
```

## Long documents

`completion` says how to handle a document too large for one request:

| | |
|---|---|
| `"forbidden"` *(default)* | one request, whole document |
| `"paginate"` | one request per page, then merge |
| `"concatenate"` | pack pages into requests under `maxCharsPerRequest`, then merge |

Multi-request runs send a schema with `required` stripped and validate only the **merged**
result. Without that, a page that legitimately has no invoice number makes the model's honest
partial answer a hard failure. See [`src/relax.ts`](./src/relax.ts). Merging concatenates
arrays and keeps the *first* present scalar, so a later chunk cannot overwrite a good value
with a null.

## Cost and caching

`pricing` is USD per million tokens, keyed by model id. Without it, `costUsd` is honestly
`undefined` rather than `0`, which would read as "this was free".

`cache` (`memoryCache()` or `fileCache(dir)`) keys on model id, prompts **and** the JSON Schema,
so a schema change can never be served an old shape.
