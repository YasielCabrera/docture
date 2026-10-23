---
"docture": minor
"@docture/cli": patch
---

Report optional `cacheReadTokens` and `cacheWriteTokens`, and price provider cache reads and writes at configured rates. Missing cache rates use the input rate. Export `sumUsage` to combine usage with the same rules across extraction, splitting, and conversion.

Include classifier calls and schema-failed model calls in reported usage. Classifier options now accept `pricing` and `instructions`. `ModelOutputError` carries `MODEL_OUTPUT_FAILED`, the SDK cause, and available usage. Failed extraction attempts retain this usage through fallback.

Direct strategy, layout-analyzer, and splitter calls now throw `ModelOutputError` for schema failures. Code that checked `NoObjectGeneratedError.isInstance(error)` must inspect `error.cause` instead. Configured shared instructions now reach the classifier prompt, which can change its verdicts and makes classifier cache entries created without those instructions unreachable.

Share cache, pricing, temperature, retries, and instructions with vision and classification in `createLlmExtractor`. CLI classification shares its available model options and cache with the strategies.
