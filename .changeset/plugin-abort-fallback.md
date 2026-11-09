---
"docture": patch
---

A loader, classifier or strategy that throws its own `AbortError` or `TimeoutError` (for example from `AbortSignal.timeout()` inside an HTTP call) now counts as a failed attempt, so the next component still runs. Only an abort of the caller's own signal stops the pipeline.
