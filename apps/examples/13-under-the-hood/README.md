# 13-under-the-hood — Under the hood

> `createExtractor` from a config object, `components`, read-once-extract-many, `runPipeline`.

**Needs:** `pnpm fetch`. No API key.

```sh
pnpm --filter @docture/examples internals
```

Docs: [`reference/architecture`](../../docs/content/docs/reference/architecture.mdx)

## What you learn

`Extractor` is a composition root, and a convenient one. Everything it does is available a
layer down, which matters in three situations: wiring that comes from a config file,
reading a document once and extracting several things from it, and a host that already has
its own orchestration.

## Wiring as data

`createExtractor` and `new Extractor({...})` are the same thing. The declarative form
exists precisely because **a fluent chain cannot be assembled from a loop** — so this
works:

```ts
createExtractor({
  loaders: config.loaders.map((name) => name === "pdfjs" ? new DocumentLoaderPdfJs() : new DocumentLoaderMuPdf()),
  strategies: config.parsers.map(...),
})
```

`extractor.components` is a **getter** (not a method) returning copies, so a caller cannot
mutate the wiring by holding the arrays. Useful for a startup log: "which loaders and
strategies is this process actually running?" should not require reading the code that
built it.

## Read once, extract many

```
three extractions took     0 ms, on one parse
the same three from disk   17 ms, three parses
```

A `LoadedSource` is a document that has already been read, offered as a source. The load
stage is **skipped entirely** — no loader is consulted and no bytes are read — which is
why it carries its own facts.

One page, so the gap is small. On a 200-page scan it is the difference between a report
that finishes and one that gets killed. This is the mechanism behind `Process` (example
11) and behind `pagesOf` (example 10).

## `runPipeline`

`PipelineComponents` is what `Extractor` holds. Assembling it by hand gives you the run
loop — load, features, classify, route, attempt, validate — with none of the class. The
class is a convenience over this function, not a layer with its own behaviour, and the
example proves it by declaring the strategies in the opposite order and watching the
fallback record itself identically.

## What to read next

[`14-testing-your-pipeline`](../14-testing-your-pipeline) — the test kit.
