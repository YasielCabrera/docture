# 11-bundles-and-splitting — Bundles and splitting

> `Process`, the split report, narrowing over the classification list, `onUnclassified`, `defineSplitter`, EAGER vs LAZY, the LLM splitters.

**Needs:** `pnpm run fetch`. The deterministic splitter runs with no key; `TextSplitter`/`ImageSplitter` need `AI_GATEWAY_API_KEY`.

```sh
pnpm --filter @docture/examples bundles
```

Docs: [`concepts/bundles-and-splitters`](../../docs/content/docs/extraction/splitting.mdx)

## Imports and installs

`Process` and deterministic splitter helpers come from `docture`. Model splitters
come from `docture/llm/split`, also re-exported by `docture/llm`. The image path
uses `MuPdfRasterizer` from `docture/loaders/mupdf`. Add `ai@^7.0.0` for model calls.

For a separate application:

```sh
pnpm add docture pdfjs-dist mupdf zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## What you learn

`statement.pdf` is not one document:

```
pages         recognised as         extracted
1 to 3        checking-account      yes
4 to 5        credit-line           yes
6             UNKNOWN               skipped
```

Extracting it as *one* document would mean asking a single schema to describe all three,
which is how a checking balance ends up in a credit-limit field.

`Extractor` answers "what is in this document?". `Process` answers "what documents are in
this file, and what is in each of them?".

## The file is read once

However many documents come out of it. Each is extracted from the pages already in
memory, not re-parsed — the same `LoadedSource` mechanism as examples 10 and 13.

`split()` is lazy: it records the plan and returns, so the chain reads in one breath and
only `extract()` is awaited. It also carries the classification list into the **return
type**, which is where the payoff is:

```ts
if (document.name === "checking-account") document.data.transactionRows;  // narrowed
else                                      document.data.creditLimit;      // narrowed
```

## Page 6 belongs to nobody

The default is `onUnclassified: "throw"`, deliberately:

```
UNCLASSIFIED_GROUP
Pages 6 were split off as "UNKNOWN", which is not one of the classifications given
(checking-account, credit-line). Pass { onUnclassified: "skip" } to drop them instead.
```

Pages that fall out of a bundle are exactly the ones nobody notices are missing. Dropping
them has to be something you said.

## A splitter answers exactly one question

"Is page B a continuation of page A's document?" Core does the folding, in
`aggregateDocGroups`. That division is deliberate: an image splitter and a text splitter
genuinely disagree about how to **judge** a seam, and must not be able to disagree about
what a run of "yes" answers **means**.

`pageWindows` is the unit of work behind LAZY — six pages, five overlapping pairs, so
every seam appears in exactly one window. EAGER without a `splitEager` implementation
degrades to LAZY rather than throwing: the strategy is a performance preference, and
losing it should not lose the answer.

## And the cost

`process.lastSplit` reports the cut **and what deciding it cost**. This splitter reads
headings, so it is zero — but the field is there either way. Splitting a 60-page scan is
not free, and a cost report that omits it is wrong rather than incomplete.

## What to read next

[`12-accuracy-and-batch`](../12-accuracy-and-batch) — is it right, and what did it cost?
