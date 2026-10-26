---
"docture": minor
---

Run text chunks and vision page groups with a default concurrency of four. Preserve input-order results, stop scheduling new work after failure, and abort and drain active requests. Export mapWithConcurrency for bounded, ordered work with cancellation.

Preserve completed usage when sibling transport, render, or cache work fails, while keeping the original provider error. Strategies can report known failure usage through the optional StrategyContext.reportFailureUsage callback.
