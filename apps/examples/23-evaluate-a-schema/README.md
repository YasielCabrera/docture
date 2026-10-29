# 23-evaluate-a-schema — Evaluate a schema on your own dataset

> `defineEval` for a lab report, a hand-written `Dataset` over a manifest, two experiments, reporters, a baseline comparison and the gate.

**Needs:** nothing. No API key and no download.

```sh
pnpm --filter @docture/examples evaluate
```

Docs: [`guides/measuring-accuracy`](../../docs/content/docs/evaluation/quick-start.mdx)

## Imports and installs

`defineEval`, the comparators and `defineReporter` come from `@docture/eval`. The runner and
`memoryRunStore` come from `@docture/eval/runner`, `fromDocture` from
`@docture/eval/docture`, `fileDocument` from `@docture/eval/node`, and each reporter from
its own `@docture/eval/reporters/*` entry. The model is the AI SDK's `MockLanguageModelV4`
from `ai/test`.

For a separate application:

```sh
pnpm add docture ai@^7.0.0 zod
pnpm add -D @docture/eval
```

## The schema is not an invoice

A lab report has a patient, a collection date and a table of results. Each result has an
analyte, a value, a unit and a flag. `defineEval` derives the spec from the same Zod
contract the extractor uses, and fails closed: every string needs a comparator and the
results table needs an alignment rule. Results pair by analyte with `hungarian`, values
match within 0.1% with `number({ rel: 0.001 })`, and the collection date matches by day
with `date()`, so `2 April 2026` equals `2026-04-02`.

## The dataset layout is yours

`lab-reports/manifest.json` lists each case with its report, its truth file, its lab and
its patient. Eval prescribes no layout. `manifestDataset` is a `Dataset`: an `id` and a
`cases()` method that reads the manifest, parses each truth file with the Zod schema,
tags the case with its lab, and groups reports of one patient so run comparison resamples
them together.

## Two experiments, two runs

`parser` is a deterministic strategy. Its baseline version reads every Southgate flag as
`normal`. The candidate fixes that. `llm` is docture's LLM strategy over a mocked model
that misplaces the decimal point of the first Southgate result. Both runs go into one
`memoryRunStore`, and the candidate names the baseline, so its result carries the
comparison.

Four cases is a small sample. The paired test reports `insufficient` support for the
parser's improvement, while the summary delta shows it moved by 3 fields in 48.

## Reporters and the gate

The candidate run writes Markdown, JUnit, split JSON and a custom flag audit, all from the
one result. The gate requires F1 of at least 0.9 for every experiment, at least 0.95 on the
`lab=south` slice, and no F1 drop above 0.02 against the baseline. The fixed parser passes.
The mocked model fails the south slice at 0.9167, which is the check a CI job running
`docture eval run` would exit 1 on.

## What to read next

[`15-cli`](../15-cli) — the command line, including `docture eval`.
