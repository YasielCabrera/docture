# 24-synthetic-corpus: generate a labeled corpus and score a processor on it

> A utility-bill schema, a seeded model, two templates with honest printed masks, digital, scan and photo renditions, and an `@docture/eval` run sliced by rendition and template, with grounding against the synthetic boxes.

**Needs:** nothing. No API key and no download.

```sh
pnpm --filter @docture/examples synthetic
```

Docs: [`guides/synthetic-corpus`](../../docs/content/docs/guides/synthetic-corpus.mdx)

## Imports and installs

`defineModel`, `gen`, the constraints, `scenario`, `defineTemplate`, `prints` and
`drawTable` come from `@docture/synthetic`. `writeCorpus` and the rendition helpers
`digital`, `scan` and `photo` come from `@docture/synthetic/node`. Scoring uses
`defineEval` from `@docture/eval`, `jsonlDataset` from `@docture/eval/node`, `runEval` from
`@docture/eval/runner` and `groundingSection` from `@docture/eval/grounding`. The processor
reads the text layer with `DocumentLoaderPdfJs` from `docture/loaders/pdfjs`.

For a separate application:

```sh
pnpm add docture zod
pnpm add -D @docture/synthetic @docture/eval pdfkit@0.19.1 pdfjs-dist@6.2.108 @napi-rs/canvas@1.0.10 sharp@0.35.5
```

`pdfkit` renders, `pdfjs-dist` reads each digital PDF back to verify every label, and
`sharp` with `@napi-rs/canvas` produces the scan and photo renditions.

## The schema is the one you extract with

`UtilityBill` is a plain Zod schema: a 12-digit account number whose last digit is a Luhn
check digit, a service address, a service period, two meter readings, usage lines,
a previous balance, the current charges, the amount due and a due date. Nothing in it is
specific to synthesis.

## The model makes values that add up

`defineModel` fills every position from the schema and lets you override any of them with
a generator keyed by path (`usage[].kwh`). Each draw comes from a stream keyed by the seed
and that path, so adding a field never changes the others. `derive` recomputes each line
amount, the current charges, the amount due and the current meter reading. The constraints
check the Luhn digit, the line sum, the date order and the meter delta. A sample that
breaks one throws `SynthesisError` instead of becoming a wrong label.

Two scenarios vary the model without breaking it. `many-lines` asks for 40 to 55 usage
lines, so the US bill continues on a second page. `credit-balance` makes the previous
balance a credit and promises it with `expect`.

## Each template says what it prints

`compact-us` is a one-column US Letter bill. `zweispaltig-de` is a two-column German A4
bill. `printed` must name every schema field, and it is the answer key: the US bill never
shows the meter id, the German bill never shows the due date, and both print the tariff
through `prints()` as a plan name that loses information (`standard` and `green` both
print `Flat rate`). The German bill also prints each usage line's German name, so its
ground truth holds that name. A field drawn without a declaration, or declared and never
drawn, fails the render with `TemplateError`.

## The corpus is resumable and scored as is

`writeCorpus` renders each seed, scenario and template once, verifies every label against
the PDF text layer, and derives a scan and a photo from the same rendering. Every box goes
through the same warp as the page. It writes `manifest.jsonl`, which `jsonlDataset` reads
with tags for `template`, `scenario` and `rendition`. A rerun skips every case whose inputs
and files are unchanged.

The processor under test reads the text layer and parses five fields with one regular
expression each. It scores F1 1.0 on every digital case and 0 on every scan and photo,
because a degraded rendition has no text layer. That is the result the slices exist to
show. Its cited boxes land inside the boxes the renderer recorded, so grounding counts
every digital value as grounded.
