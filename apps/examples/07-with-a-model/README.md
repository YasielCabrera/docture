# 07-with-a-model — With a model

> `LLM` and `loadLlm`, gateway string vs provider instance, the prompt printed, pricing, caching, two models at once.

**Needs:** `pnpm fetch` **and** `AI_GATEWAY_API_KEY`. Skips loudly without a key.

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

## What you learn

The document is `invoice-aws`, deliberately: example 06 showed that neither hand-written
parser can read it. This is the layout nobody wrote a parser for, which in production is
most of them.

`loadLlm` takes a `ModelBackend`, not a `LanguageModel`. That indirection is the whole
reason `@docture/core` does not depend on the AI SDK — and a test in `packages/core`
enforces it. `LLM` is the implementation of that seam, and one `LLM` knows how to become
four things: the text strategy, the vision strategy, the classifier and the splitter.

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
