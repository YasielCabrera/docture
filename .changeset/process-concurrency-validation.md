---
"docture": patch
---

`Process.extract()` rejects a `concurrency` that is not a positive integer with `InvalidOptionError` (code `INVALID_OPTION`) before reading the source. `NaN` previously started no workers and returned empty results.
