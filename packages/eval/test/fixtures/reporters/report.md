# Eval run run-1

## Overview

Run run-1 is complete. Dataset invoices has 4 cases; 1 epoch. Git main at 8d04891.

| Metric | llm | parser |
| --- | ---: | ---: |
| Cases | 4 | 3 |
| Scored | 3 | 2 |
| Errored | 1 | 0 |
| Skipped | 0 | 1 |
| F1 | 76.9% | 93.9% |
| Precision | 89.7% | 100.0% |
| Recall | 67.3% | 88.5% |
| Exact cases | 25.0% | 50.0% |
| ANLS | 91.8% | 88.5% |
| Grounded F1 | 80.0% | n/a |
| Errored cases | 25.0% | 0.0% |
| Skipped cases | 0.0% | 33.3% |
| Fallback cases | 25.0% | 0.0% |
| Cost | $0.0300 | n/a |
| Tokens | 3,000 | n/a |
| Latency p50 | 875 ms | 14 ms |
| Latency p95 | 1.4 s | 15 ms |

## Segments: llm

| Segment | F1 | Precision | Recall | Match | Mismatch | Omission | Hallucination |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| header | 64.3% | 75.0% | 56.3% | 9 | 3 | 4 | 0 |
| lineItems | 81.0% | 94.4% | 70.8% | 17 | 1 | 6 | 0 |
| totals | 85.7% | 100.0% | 75.0% | 9 | 0 | 3 | 0 |

## Segments: parser

| Segment | F1 | Precision | Recall | Match | Mismatch | Omission | Hallucination |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| header | 100.0% | 100.0% | 100.0% | 8 | 0 | 0 | 0 |
| lineItems | 85.7% | 100.0% | 75.0% | 9 | 0 | 3 | 0 |
| totals | 100.0% | 100.0% | 100.0% | 6 | 0 | 0 | 0 |

## Slice rendition: llm

| rendition | Cases | F1 | Precision | Recall | Exact cases | Errored cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digital | 2 | 92.3% | 92.3% | 92.3% | 50.0% | 0.0% |
| scan | 2 | 56.4% | 84.6% | 42.3% | 0.0% | 50.0% |

## Slice rendition: parser

| rendition | Cases | F1 | Precision | Recall | Exact cases | Errored cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digital | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% |
| scan | 2 | 87.0% | 100.0% | 76.9% | 0.0% | 0.0% |

## Paths: llm

| Path | F1 | Match | Mismatch | Omission | Hallucination | Similarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| issuer | 28.6% | 1 | 2 | 1 | 0 | 0.507 |
| issueDate | 57.1% | 2 | 1 | 1 | 0 | 0.778 |
| lineItems\[\].amount | 71.4% | 5 | 1 | 2 | 0 | 0.967 |
| lineItems\[\].description | 85.7% | 6 | 0 | 2 | 0 | 1 |
| lineItems\[\].sku | 85.7% | 6 | 0 | 2 | 0 | 1 |
| reference | 85.7% | 3 | 0 | 1 | 0 | 1 |
| status | 85.7% | 3 | 0 | 1 | 0 | 1 |
| totals.net | 85.7% | 3 | 0 | 1 | 0 | 1 |
| totals.tax | 85.7% | 3 | 0 | 1 | 0 | 1 |
| totals.total | 85.7% | 3 | 0 | 1 | 0 | 1 |

## Paths: parser

| Path | F1 | Match | Mismatch | Omission | Hallucination | Similarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| lineItems\[\].amount | 85.7% | 3 | 0 | 1 | 0 | 1 |
| lineItems\[\].description | 85.7% | 3 | 0 | 1 | 0 | 1 |
| lineItems\[\].sku | 85.7% | 3 | 0 | 1 | 0 | 1 |
| issueDate | 100.0% | 2 | 0 | 0 | 0 | 1 |
| issuer | 100.0% | 2 | 0 | 0 | 0 | 1 |
| reference | 100.0% | 2 | 0 | 0 | 0 | 1 |
| status | 100.0% | 2 | 0 | 0 | 0 | 1 |
| totals.net | 100.0% | 2 | 0 | 0 | 0 | 1 |
| totals.tax | 100.0% | 2 | 0 | 0 | 0 | 1 |
| totals.total | 100.0% | 2 | 0 | 0 | 0 | 1 |

## Comparison: run-0/llm to run-1/llm

| Metric | Baseline | Candidate | Summary delta | Paired delta | Paired CI | p | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| F1 | 80.0% | 82.0% | +2.0 pp | -5.0 pp | -9.0 pp to -1.0 pp | &lt;0.001 | REGRESSED |
| Exact cases | 25.0% | 50.0% | +25.0 pp | +25.0 pp | n/a | 0.500 | inconclusive (not significant) |

3 paired cases, 0 only in the baseline, 1 only in the candidate.

Test auto, alpha 0.05, clustered by group.

## Comparison by segment (llm)

| Segment | Metric | Baseline | Candidate | Summary delta | Paired delta | Paired CI | p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| totals | F1 | 100.0% | 100.0% | ±0.0 pp | ±0.0 pp | n/a | n/a | unchanged (identical pairs) |

## Path changes (llm)

| Path | Metric | Baseline | Candidate | Summary delta | Paired delta | Paired CI | p | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| lineItems\[\].amount | F1 | 100.0% | 50.0% | -50.0 pp | -50.0 pp | n/a | n/a | insufficient support |

## Changed cases (llm)

| Case | Epoch | Metric | Baseline | Candidate | Change |
| --- | ---: | --- | ---: | ---: | --- |
| c3 | 0 | outcome | scored | errored | newly errored |
| c2 | 0 | F1 | 100.0% | 84.6% | regressed |

## Comparison: run-0/parser to run-1/parser

| Metric | Baseline | Candidate | Summary delta | Paired delta | Paired CI | p | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| F1 | 80.0% | 90.0% | +10.0 pp | +10.0 pp | +5.0 pp to +15.0 pp | 0.001 | IMPROVED |
| Cost | $1.00 | $2.00 | +$1.00 | n/a | n/a | n/a | not tested (no paired values) |
| ANLS | n/a | 90.0% | n/a | n/a | n/a | n/a | incomparable (missing value) |

3 paired cases, 0 only in the baseline, 0 only in the candidate.

Test auto, alpha 0.05, clustered by group.

## Changed cases (parser)

| Case | Epoch | Metric | Baseline | Candidate | Change |
| --- | ---: | --- | ---: | ---: | --- |
| c2 | 1 | outcome | errored | scored | fixed |
| c1 | 1 | F1 | 80.0% | 90.0% | improved |

## Calibration: llm

| pattern | Support | ECE | MCE | Brier | AUROC | AP | Coverage at 95.0% | Coverage at 99% accuracy | Auto-accept threshold | Accepted support | Ground truth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 20 | 0.045 | 0.1 | 0.08 | 0.91 | 0.97 | 60.0% | 50.0% | 0.9 | 10 | 25 |

20 of 26 produced fields carried a confidence (76.9% confidence coverage). 2 omissions. Auto-accept target 95.0%, minimum support 1.

## Accuracy at coverage and coverage at accuracy: llm

| pattern | Target | Accuracy at coverage | Coverage at accuracy |
| --- | ---: | ---: | ---: |
| overall | 50.0% | 100.0% | n/a |
| overall | 80.0% | 93.8% | n/a |
| overall | 90.0% | n/a | 80.0% |
| overall | 99.0% | n/a | 50.0% |
| overall | 100.0% | 80.0% | 50.0% |

## Grounding: llm

| Path | Predicted | Labelled | Correct | Supported | Grounded | With evidence | Hallucinated | Grounded precision | Grounded recall | Grounded F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 7 | 8 | 7 | 6 | 6 | 7 | 1 | 85.7% | 75.0% | 80.0% |
| issuer | 2 | 2 | 2 | 2 | 2 | 2 | 0 | 100.0% | 100.0% | 100.0% |

box level, IoU 0.5.

Labelled cases scored: 2. Unlabelled cases not scored: 1.

## Grounding by segment: llm

| Segment | Predicted | Labelled | Correct | Supported | Grounded | With evidence | Hallucinated | Grounded precision | Grounded recall | Grounded F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| header | 2 | 2 | 2 | 2 | 2 | 2 | 0 | 100.0% | 100.0% | 100.0% |

## Gate: fail

| Status | Kind | Experiment | Check | Value | Bound | Message |
| --- | --- | --- | --- | ---: | --- | --- |
| fail | threshold | llm | f1 | 76.9% | min 80.0% | f1 for experiment llm is 0.7692, below the minimum 0.8 |
| pass | threshold | parser | f1 | 93.9% | min 80.0% | f1 for experiment parser is 0.9388 |
| pass | threshold | llm | errorRate | 25.0% | max 50.0% | errorRate for experiment llm is 0.25 |
| pass | threshold | parser | errorRate | 0.0% | max 50.0% | errorRate for experiment parser is 0 |
| pass | regression | llm | f1 drop | -2.0% | max 2.0% | f1 for experiment llm changed by 0.02, within the drop budget 0.02 |
| pass | regression | parser | f1 drop | -10.0% | max 2.0% | f1 for experiment parser changed by 0.1, within the drop budget 0.02 |

6 checks, 1 failed.

## Failures

4 of 7 cases failed.

| Case | Experiment | Epoch | Outcome | F1 | Precision | Recall | Problems | Time | Cost | Message |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| c2 | llm | 0 | scored | 84.6% | 84.6% | 84.6% | 2 | 1.5 s | $0.0180 |  |
| c3 | llm | 0 | errored | 0.0% | n/a | 0.0% | n/a | 300 ms | n/a | ExtractionFailedError: Every extraction strategy failed. |
| =HYPERLINK("x")\|&lt;b&gt;&amp;'c' | llm | 0 | scored | 84.6% | 84.6% | 84.6% | 2 | 910 ms | n/a |  |
| c3 | parser | 0 | scored | 87.0% | 100.0% | 76.9% | 3 | 15 ms | n/a |  |

### c2 (llm, epoch 0)

| Path | Status | Expected | Actual | Hint |
| --- | --- | --- | --- | --- |
| issuer | mismatch | Northwind Industrial GmbH | Southwind Trading |  |
| lineItems\[1\].amount | mismatch | 20 | 25 |  |

- assertion sum(lineItems\[\].amount) = totals.net: lineItems\[\].amount sums to 35, not 30

### c3 (llm, epoch 0)

ExtractionFailedError \[EXTRACTION\_FAILED\]: Every extraction strategy failed.

### =HYPERLINK("x")\|&lt;b&gt;&amp;'c' (llm, epoch 0)

| Path | Status | Expected | Actual | Hint |
| --- | --- | --- | --- | --- |
| issuer | mismatch | Northwind Industrial GmbH | =SUM(A1) | digits differ |
| issueDate | mismatch | 2024-03-05 | 2024-05-03 | date-format (day and month swapped) |

### c3 (parser, epoch 0)

| Path | Status | Expected | Actual | Hint |
| --- | --- | --- | --- | --- |
| lineItems\[1\].sku | omission | B-200 |  |  |
| lineItems\[1\].description | omission | Washers |  |  |
| lineItems\[1\].amount | omission | 20 |  |  |

- lineItems: 1 of 2 rows matched, 1 missing
- assertion sum(lineItems\[\].amount) = totals.net: lineItems\[\].amount sums to 10, not 30

## Warnings

- Spec changed since the baseline run.
