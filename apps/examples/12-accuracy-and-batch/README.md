# 12-accuracy-and-batch — Accuracy and batch

> `scoreExtraction`, the truth-completeness trap, the three tolerances, `formatScoreboard`, `extractBatch`.

**Needs:** `pnpm fetch`. No API key.

```sh
pnpm --filter @docture/examples accuracy
```

Docs: [`guides/measuring-accuracy`](../../docs/content/docs/guides/measuring-accuracy.mdx)

## What you learn

Eleven real invoices, each with ground truth **published by somebody else**. That last
part is what makes this an eval rather than a self-congratulation: truth you wrote
yourself is truth you will bend, unconsciously, until the number looks good.

## The trap — read this one even if you skip the rest

`scoreExtraction` counts a field the extraction produced and the truth **omits** as a
*hallucination*. That is exactly right for grading a real run: a model inventing a
`dueDate` is a serious fault, not a bonus.

It also means an **incomplete answer key punishes an extractor for being more complete
than the key**:

```
how it was scored                         F1   hallucinations   verdict
full contract vs 5-field truth         0.192               42   meaningless
projected onto what truth claims       1.000                0   a real number
```

Same extraction. Same document. The first number is garbage. Those 42 "hallucinations"
are every field invoice2data simply did not publish, and not one of them is wrong.

`projectOntoTruth` drops the fields the answer key is silent about, so the score grades
what the truth actually asserts. **This is the single most common way a real eval harness
lies, and it lies in the flattering direction as often as not — which is why it survives
code review.**

## What the published truth can and cannot grade

Two truths, deliberately:

- [`shared/truth/azure-interior.ts`](../shared/truth/azure-interior.ts) — hand-transcribed
  and **complete**: 14 fields and all 4 line items, checked against the text layer. This
  is what makes an F1 of 1.0 mean something.
- [`shared/truth/published.ts`](../shared/truth/published.ts) — a mapper onto five scalar
  fields, and **line items are deliberately excluded**. The reason is measured, not
  assumed: the container is `lines` in six samples and `line_items` in two, the
  description key is `name`/`desc`/`item` by template, four samples publish no line items
  at all, the Odoo sample's only `lines` entry is a *section header*, and on the services
  invoice `item` is `"A"` where our `description` is `"Service A"`. Two answer keys that
  disagree about what a line item's description *is* cannot grade each other's.

"Published" does not mean "correct".

## The three tolerances

`numericTolerance` (default 0.01) is not a nicety. **The Odoo invoice rounds its own
tax**: 112.90 × 0.15 is exactly 16.935 and the page prints 16.94. Worse, binary floating
point puts 16.935 a hair *below* the midpoint, so `Math.round` gives 16.93. An equality
check on money is a bug waiting for a document like this one.

`stringSimilarity` (default 0.9) has a live case here too — "Sammy Maystone" vs "Sammy
Maystone - For Lines testing". The example scores it at three thresholds. There is no
right answer, which is the point: it is a decision about your domain, so the library makes
you make it rather than picking silently.

`alignArraysBy` switches from index to key alignment. Index is right for a **table**,
where document order is meaningful; key alignment is for a set where it is not.

## Coverage and accuracy are two numbers

Nine of eleven layouts have no parser, so they are not in the scoreboard at all. An eval
that quietly averaged only what succeeded would print a beautiful mean F1 for a pipeline
that reads two documents in eleven.

## What to read next

[`13-under-the-hood`](../13-under-the-hood) — below the facade.
