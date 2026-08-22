# @docture/eval

Grade an extraction run.

```ts
import { formatFailures, scoreExtraction } from "@docture/eval";

const result = await extractor.extract(pdf.bytes, Invoice);
const score = scoreExtraction(groundTruth, result.data);

expect(score.f1, formatFailures(score)).toBe(1);
```

## The metric

Precision / recall / F1 over flattened leaf paths, with typed comparators. Whole-document exact
match is reported too, but it is too blunt to steer by: one misread digit and every document
scores zero, which tells you nothing about whether a change helped.

Every field lands in one of four buckets, and the distinction matters. A **hallucination** is
not a typo:

| | |
|---|---|
| `match` | both present and equal under the right comparator |
| `mismatch` | both present, different |
| `omission` | ground truth has it, the extraction does not |
| `hallucination` | the extraction invented it |

Comparators are chosen by type, then by path: numbers get a tolerance (default one cent), dates
compare as days, strings get a similarity floor (default 0.9, which forgives an OCR slip in a
long name without accepting a different name).

## Arrays

Index-aligned by default, because for a table document order is meaningful and silently
reordering rows would hide a real bug. Pass `alignArraysBy: "id"` when order is not meaningful.

## Reporting

`aggregate`, `formatScoreboard` (stable Markdown, so a diff between runs is readable) and
`formatFailures`, which never lets a truncated list read as a complete one.
