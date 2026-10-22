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
compare as days, and strings get a similarity floor (default 0.9). The digits in both strings
must be identical and in the same order before the similarity floor applies. This allows an
OCR letter slip in a name or address, such as `Main Streat 12` against `Main Street 12`, but
rejects an invoice number or IBAN with a changed digit.

Dates compare by their written calendar day without time-zone conversion.
The parser accepts `YYYY-MM-DD`. A date can include a time separated by `T` or a space.
The time requires hours and minutes, with optional seconds. Seconds may include a
fractional part. Offsets can be `Z`, `±HH:mm`, `±HHmm`, or `±HH`.

English month formats include `Jan 15 2026`, `January 15, 2026`, and `15 January 2026`.
Month names accept their full name or three-letter abbreviation, without regard to case.
Abbreviations may end in a period, as in `Jan. 15, 2026`. Day-first forms may use a comma,
as in `15 Jan, 2026`. Calendar dates must be valid, including leap days. Numeric forms
such as `01/02/2026` are not parsed as dates.

The date comparator applies when the expected value is ISO-shaped or the final path
segment contains a date word (`date`, `dates`, `issued`, or `due`) or ends in the word `at`.
The aliases `birthdate`, `startdate`, and `enddate` also qualify. Camel case, `_`, and `-`
separate words, as in `issuedAt` and `invoice_date`. Parent segments and names such as
`candidate`, `format`, and `vat` do not select it.

## Arrays

Index-aligned by default, because for a table document order is meaningful and silently
reordering rows would hide a real bug. Pass `alignArraysBy: "id"` when order is not meaningful.

## Reporting

`aggregate`, `formatScoreboard` (stable Markdown, so a diff between runs is readable) and
`formatFailures`, which never lets a truncated list read as a complete one.
