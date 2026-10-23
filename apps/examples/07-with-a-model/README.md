# 07-with-a-model — With a model

> `LLM` and `loadLlm`, gateway string vs provider instance, the prompt printed, pricing, caching, two models at once.

**Needs:** `pnpm run fetch` **and** `AI_GATEWAY_API_KEY`. Skips loudly without a key.

```sh
pnpm --filter @docture/examples model
```

Docs: [`guides/with-a-model`](../../docs/content/docs/guides/with-a-model.mdx)

## Why this one needs a real key

There is no mock here. A mock would teach you the wiring and lie about the answer, and
the answer is the thing a model is for. Without a key the example prints a bordered block
naming the variable and exits 0 — a missing key is not a failure.

```sh
AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples model
DOCTURE_MODEL=anthropic/claude-opus-5 AI_GATEWAY_API_KEY=... pnpm ... model
```

The one place a mock model *does* belong is a test — see
[`14-testing-your-pipeline`](../14-testing-your-pipeline).

## Imports and installs

Import `Extractor` from `docture`, `LLM` from `docture/llm`, and the PDF loader
from `docture/loaders/pdfjs`. Text extraction also has the narrow
`docture/llm/text` entrypoint. Install the AI SDK explicitly.

For a separate application:

```sh
pnpm add docture ai@^7.0.0 pdfjs-dist@6.2.108 zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

The document is `invoice-aws`, deliberately: example 06 showed that neither hand-written
parser can read it. This is the layout nobody wrote a parser for, which in production is
most of them.

`loadLlm` takes a `ModelBackend`. The `docture` root entrypoint uses that interface
without loading the AI SDK. `LLM` from `docture/llm` implements it and needs the optional
`ai` peer. One `LLM` can create the text strategy, vision strategy, classifier, and
splitter.

## Three knobs, three scopes

| Option | What it does |
|---|---|
| `system` | **replaces** the default system prompt. Reach for it last |
| `instructions` | **appends** to it. The usual place for domain guidance |
| `hints` | per-classification notes, keyed by name. Layout quirks |

The example prints the assembled prompt, so you can see exactly what was sent. Note the
document is wrapped in delimiters: without them, a document containing something that
reads like an instruction is indistinguishable from one.

## Cost, and caching

Without a pricing table `usage.costUsd` stays **absent** — honestly — rather than
reporting a zero that might mean "free" or might mean "unpriced". With one, the example
runs the same document twice through a `memoryCache` and the second run costs nothing.

The cache key covers the model id, both prompts **and the JSON Schema**. Leave the schema
out and a schema change silently returns the old shape.

## What to read next

[`08-long-documents`](../08-long-documents) — when one request is not enough.
