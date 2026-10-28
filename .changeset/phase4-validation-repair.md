---
"docture": minor
---

Repair invalid answers. When a strategy's answer fails the schema, or a validation rule in `"fail"` mode, the pipeline now asks the strategy again with its previous answer and the issues before trying the next strategy. `LlmStrategy` and `VisionStrategy` implement the new optional `ExtractionStrategy.repair(ctx, previous)`. This changes default behavior and cost: one repair per strategy is on by default (`maxRepairs: 1`), so an invalid model answer now costs one more billed request before fallback. Set `maxRepairs: 0` on the extractor or the call to keep one request per strategy. Each repair is recorded as an attempt with `stage: "repair"` and its usage is included in `result.usage`. `maxRetries` still only retries failed transport requests. Report-mode rule issues never trigger a repair.
