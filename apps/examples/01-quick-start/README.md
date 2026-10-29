# 01-quick-start — Quick start

> `Extractor` wiring, `contract`, the three ways to extract, and the result envelope.

**Needs:** `pnpm run fetch`. No API key.

```sh
pnpm --filter @docture/examples quick-start
```

Docs: [`quick-start`](../../docs/content/docs/extraction/quick-start.mdx)

## Imports and installs

`Extractor` comes from `docture`; `DocumentLoaderPdfJs` comes from
`docture/loaders/pdfjs`.

For a separate application:

```sh
pnpm add docture pdfjs-dist zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

Two lines of wiring — a loader and a strategy — and the three questions you can ask:

| Call | Returns | Reach for it when |
|---|---|---|
| `extractData(src, contract)` | just the fields | you trust the pipeline and want the data |
| `extract(src, contract)` | the envelope | almost always. See below |
| `extractResult(src, contract)` | the envelope, unvalidated shape | you are writing a `Process`-like layer |

## Reading the output

The envelope is the part worth understanding, because it answers the questions you
actually have when a number looks wrong:

```
answered by "odoo-invoice-parser" via loader "pdfjs" in 7 ms
no tokens, no cost
strategies tried           1
contract validated         yes
items sum to subtotal      yes
```

`result.method` is which strategy answered. `result.attempts` is everything tried before
it, in order, each with its error. `result.usage.costUsd` is **absent** rather than `0`
when nothing priced the run — a zero would be indistinguishable from "it was free".

The last line is the one that matters most. A parser that quietly dropped a row still
prints a table that looks fine; the arithmetic is what notices.

## What to read next

[`02-contracts-and-schemas`](../02-contracts-and-schemas) — the shape you ask for, and
why `null` is not the same as absent.
