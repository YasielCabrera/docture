---
"@docture/cli": patch
---

Include failed extractions in the eval scoreboard, report, aggregate metrics, and `--min-f1` gate. A failed document has F1, precision, and recall zero, including when its truth is empty. Failed cases in `@docture/eval` contribute omitted truth to aggregate metrics.
