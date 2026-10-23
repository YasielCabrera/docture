# Architecture

How `src/core` is organised, and where to make a given change.

[README.md](./README.md) covers what it does. This covers the shape behind it.

---

## Layers

Dependencies point **downward only**. The rule is enforced by
[`test/core/architecture.test.ts`](./test/core/architecture.test.ts), which walks the import graph.

```
        ┌──────────────────────────────────────────┐
        │  extractor.ts  wiring + lifecycle         │   the composition roots
        │  converter.ts  document → text formats    │
        │  process.ts    bundle → documents         │
        └───────┬──────────────────────────────────┘
                │
        ┌───────▼──────────────────────────────────┐
        │  contracts/    loader · rasterizer ·      │   the plugin interfaces
        │                strategy · classifier ·    │
        │                splitter · model ·         │
        │                extractor · layout ·       │
        │                compose                    │
        └───────┬──────────────────────────────────┘
                │
        ┌───────▼──────────────────────────────────┐
        │  pipeline/     read → features →          │   control flow
        │                classify → route → attempt │
        └───────┬──────────────────────────────────┘
                │
        ┌───────▼──────────────────────────────────┐
        │  domain/       depends on nothing         │   the vocabulary
        └──────────────────────────────────────────┘

        loaders/data.ts: the ONE loader in core, because it wraps no library
```

| Layer | Owns | Changes when |
|---|---|---|
| `domain/` | what a document, a page, a line, a semantic element, a contract, a doc-group, a result and a usage figure *are*; the closed vocabularies; the word-to-line grouper; the image-header size reader | the vocabulary changes |
| `pipeline/` | eligibility → route → attempt → record; schema resolution; source resolution; the load stage; deadlines; typed failures | the orchestration contract changes |
| `contracts/` | the plugin interfaces, plus `withRasterizer` composition | an interface changes shape |
| `extractor.ts` | which components a pipeline has, and who disposes them | the default wiring changes |
| `converter.ts` and `conversion/` | conversion wiring, deterministic layout analysis, and TXT, Markdown, and HTML export | document conversion changes |
| `process.ts` | reading a bundle once, cutting it, and routing each document to an extractor | multi-document handling changes |

Two of these exist purely to keep core free of the AI SDK, which
[a test](./test/core/architecture.test.ts) enforces:

- `contracts/model.ts` declares `ModelBackend`. `extractor.loadLlm(...)` takes one of
  these, so core accepts a model without importing one. `docture/llm`'s `LLM` is the
  implementation.
- `contracts/layout-analyzer.ts` declares `LayoutAnalyzer`. `DocumentConverter` can use
  one for constrained role, grouping, and ordering assistance without importing the AI
  SDK. Deterministic analysis remains the fallback and owns all source text.
- `contracts/extractor.ts` declares `DocumentExtractor`, above the class that implements
  it, so a `Classification` can carry its own extractor without `contracts/` depending on
  the composition root.

---

## Data flow

```
DocumentSource (path | URL | bytes | RawDocument | LoadedSource)
   │
   ├─ resolveSchema()          → jsonSchema + validate + the caller's original schema
   │
   ├─ LoadedSource?            → skip the load stage entirely; features from the pages
   ├─ resolveSource()          → RawDocument, media type sniffed from magic bytes
   │
   ├─ eligibleLoaders(mimeType)
   │     └─ none               → NoEligibleLoaderError (a wiring gap, named)
   ├─ each loader in order, first that does not throw wins
   │     └─ all threw          → LoadFailedError (carrying every attempt)
   │
   ├─ documentFeatures()       → hasTextLayer, hasGeometry, hasRenderablePages, form
   │
   ├─ eligibleStrategies(features)
   │     └─ none               → NoEligibleStrategyError (carrying the features)
   │
   ├─ classify, ONLY if some eligible strategy asked for it
   │     └─ all abstain        → UNKNOWN, carrying the trail
   │
   ├─ policy(features, eligible, classification) → ordered plan
   │
   └─ each strategy in order, until one produces data that validates
         ├─ validate against the caller's schema      ← the ONE place this happens
         └─ all failed         → ContractViolationError, else ExtractionFailedError
```

Conversion shares source resolution and first-success loading with extraction. It asks
the winning loader for optional layout and asset data, rejects documents without
indexable text, applies deterministic layout analysis, optionally overlays validated
layout annotations, and exports the resulting elements. Layout annotations can refer
only to existing element IDs and cannot carry text.

---

## Load-bearing decisions

**Strategies do not validate; the pipeline does.** A strategy returns `data: unknown`.
Validation happens once, against the caller's schema, so `validation` cannot come to
mean two different things depending on which strategy answered. It also means a strategy
that produces the wrong shape is a *failed attempt* the next strategy can recover from,
rather than a hard error.

**Declaration order is the default routing policy.** The most predictable thing
available: what runs first is what you listed first, filtered to what is feasible.
A `policy` function can reorder, but it only ever sees eligible candidates, so it cannot
re-derive feasibility and get a different answer. A policy that returns a strategy
it was not offered is ignored rather than honoured.

**Requirements are about the DOCUMENT, not about wiring.** `requires: ["TEXT_LAYER"]`
states a fact that must hold of the document. An OCR engine, a model client, a
rasterizer are *constructor arguments* instead, satisfied by construction, so
"engine that cannot return layout" is a compile error at the wiring site rather than a
throw partway through a run.

**Classification is demand-driven.** If no eligible strategy asks for it, it does not
run. No wasted model call, no wasted OCR pass.

**A caller's abort is not a timeout.** `signal.throwIfAborted()` guards the loop before
every stage, so a cancelled run stops rather than relying on each plugin to notice. A
caller abort propagates and suppresses fallback; our own per-stage deadline is a
retryable failure that the next strategy still gets a turn after. The two are separate
types precisely so they can behave differently. See
[`src/core/pipeline/deadline.ts`](./src/core/pipeline/deadline.ts) for why
`AbortSignal.any` was not enough.

**Two components cannot share a name.** Checked at construction, so a duplicate is a
`DuplicateComponentError` rather than a silent shadowing.

**Disposal uses `allSettled` + `AggregateError`.** One engine's broken teardown cannot
hide another's, and `dispose()` is idempotent.

**Conversion text is loader-owned.** The deterministic analyzer may classify, group,
and order source blocks, but it does not paraphrase or synthesize their text. Optional
model assistance is restricted to existing IDs, semantic roles, grouping, and ordering.

---

## Behavioural invariants

Covered by [`test/core/extract.test.ts`](./test/core/extract.test.ts).

1. **Extraction never abstains.** An empty result is indistinguishable from a real one
   for a document with no rows, so a strategy that cannot do the job throws.
2. **Classification never throws.** A classifier that breaks that contract is recorded
   as an abstention with a note, because failing the document would deny the UNKNOWN
   path its turn.
3. **First strategy that does not throw wins**; `method` is that strategy.
4. **`attempts` records every strategy run**, in order, with its error and error code.
5. **A caller `AbortError` propagates and suppresses fallback.**
6. **A strategy requiring a classification does not run on an `UNKNOWN` verdict.**
7. **Importing this package loads no document library.** No pdf.js, no WASM, no ONNX,
   not even `ai`.

---

## Extension points

Everything below is wiring. None of it edits `pipeline/` or `domain/`.

```ts
// A loader: a plain object. `defineLoader` only pins the capability literals.
defineLoader({
  name: "acme",
  capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
  async load(document, ctx) { /* … */ },
});

// A strategy: produce data, or throw.
defineStrategy({
  name: "TABLE_TRANSFORMER",
  requires: ["GEOMETRY"],
  async extract(ctx) { return { data: /* … */ }; },
});

// A rasterizer, composed onto any loader. The result's type gains `images: true`.
withRasterizer(loader, new NapiCanvasRasterizer({ dpi: 300 }));

// A splitter: answer ONE question. Core does the folding.
defineSplitter({
  name: "heading-splitter",
  requires: ["TEXT_LAYER"],
  async belongsToSameDocument(first, second, ctx) {
    return { belongsToSameDocument: true, classificationPage1: "invoice" };
  },
});

// A routing policy: a pure function of (features, eligible, classification).
new Extractor({ loaders, strategies, policy: (f, eligible) => [...eligible].reverse() });
```

---

## The supported API

[`src/index.ts`](./src/index.ts) is the whole of it, and
[`test/core/architecture.test.ts`](./test/core/architecture.test.ts) asserts the exact list, so
widening it is a decision rather than a side effect.
