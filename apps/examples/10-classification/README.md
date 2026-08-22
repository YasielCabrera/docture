# 10-classification — Classification

> `defineClassification`, narrowing, a deterministic classifier, `LlmClassifier`, the three consensus strategies, classification trees.

**Needs:** `pnpm fetch`. The deterministic classifier runs with no key; `LlmClassifier` needs `AI_GATEWAY_API_KEY`.

```sh
pnpm --filter @docture/examples classify
```

Docs: [`concepts/classification`](../../docs/content/docs/concepts/classification.mdx)

## What you learn

A classification pairs a name with **the shape that kind produces**. The names become a
literal union in the result, and that is where the typing comes from:

```
the Odoo invoice           invoice (80%)          → Invoice
statement pages 1-3        checking-account (95%) → CheckingSummary
statement pages 4-5        credit-line (95%)      → CreditLineSummary
statement page 6           UNKNOWN (0%)           → nothing
```

`UNKNOWN` is in that union on purpose and the compiler makes you handle it. A classifier
that answers "Bill of Lading" when the candidates are `invoice` and `receipt` does not get
to win — the signal is still recorded so the disagreement stays visible, but the literal
type on the result would otherwise be a lie.

## A classifier is an interface, not a wrapper around an LLM

Every account and invoice in this corpus announces itself in a heading. That is a keyword
problem, not a judgement problem, so the classifier in this example needs no model — and a
classifier that costs nothing can run on every document as a first pass.

It is **table-driven over `ctx.candidates`**, and that matters: the same classifier is
asked "invoice or statement?" at one level of the tree and "checking or credit line?" at
the next, and it has to be right both times.

A classifier must also never throw. A broken one should not fail a document a later one
could have handled, so it returns `null` to abstain and reports trouble in the signal's
`note`.

## Disagreement is a setting, not an accident

One classifier says `invoice` at 0.80. Two say `credit-line` at 0.60 and 0.55:

```
strategy                    threshold   winner on the invoice    confidence
higherOrder                 —           invoice                         80%
consensus                   —           credit-line                     60%
consensusWithThreshold      0.9         UNKNOWN                          0%
```

Three defensible answers to the same evidence. Every signal is on the result either way —
a run where three classifiers agreed and a run where one guessed alone should not look the
same afterwards.

## A note on `pages`

`extractor.classify` takes `RunOptions`, and `RunOptions` has a `pages` field, but
**classification always looks at the whole document** — the page filter is applied by the
extraction pipeline, not the classify path. The mechanism that does work is a
`LoadedSource` narrowed to the pages you mean, and `pagesOf()` at the top of `index.ts` is
fifteen lines of it. It is also the same mechanism `Process` uses internally.

## What to read next

[`11-bundles-and-splitting`](../11-bundles-and-splitting) — a file is not a document.
