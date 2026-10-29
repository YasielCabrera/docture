# 05-your-own-plugins — Your own plugins

> `defineStrategy` in three passes, why a strategy throws, `defineLoader` with `linesFromWords`, `defineRasterizer`.

**Needs:** `pnpm run fetch`. No API key.

```sh
pnpm --filter @docture/examples plugins
```

Docs: [`concepts/strategies`](../../docs/content/docs/extraction/strategies.mdx)

## Imports and installs

The plugin factories and geometry helpers come from `docture`. The invoice
PDF reader comes from `docture/loaders/pdfjs`.

For a separate application:

```sh
pnpm add docture pdfjs-dist zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

Everything in this library that reads a document is one of these plain objects. No base
class, nothing to extend — `implements` is structural, so a fake in a test is an object
literal and a real plugin is whatever wraps your library of choice.

A strategy is built up in three passes: the minimum that is not a lie, then one that uses
all five things on `ctx`, then the real one in
[`shared/parsers/services.ts`](../shared/parsers/services.ts).

## The rule that matters most

**There is no "abstain".** A strategy that cannot do the job must *throw*, and let the
next one try:

```ts
if (head === -1) throw new Error("no Odoo item table header found");
```

A strategy that returned `{ lineItems: [] }` instead would have **won**, and reported an
invoice with no line items as a success. An empty result is indistinguishable from a real
one for a document that genuinely has no rows, so the library makes the distinction
impossible to get wrong.

## What is NOT a strategy's business

`requires` is about the **document** — `TEXT_LAYER`, `GEOMETRY`, `RENDERABLE_PAGES`. An
OCR engine, a model client and a rasterizer are constructor arguments, satisfied by
construction rather than discovered as a throw on page 40.

## The custom loader

A made-up `x,y,text` format, so the three helpers every real geometry loader needs are
visible on their own: `linesFromWords`, `textFromLines`, `inferForm`. Words sharing a `y`
become one line, so the parser reads `Widget 42.00` and never has to know about
coordinates. A real OCR loader is this plus an engine.

## What to read next

[`06-fallback-routing-and-errors`](../06-fallback-routing-and-errors) — nothing is silent.
