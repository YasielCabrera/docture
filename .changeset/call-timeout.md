---
"docture": minor
"@docture/cli": minor
---

Add `timeoutMs`, a deadline for a whole call, to extraction and classification options, `ConvertOptions`, `Process.extract()` and `splitOnly()`, and as a default on `Extractor` and `DocumentConverter`. When it passes, every component's signal aborts and the call rejects with `TIMEOUT` at stage `"call"`, even when a component ignores its signal. The layout analyzer stage deadline now abandons an analyzer that ignores its signal. The CLI `--timeout` flag is now this per-document deadline, applied with each call so it also bounds an extractor or converter the config supplies already built. `review --timeout` covers the document's conversion or extraction and its page rendering together, and the service's `flags.timeoutMs` bounds each request's whole call. Set `stageTimeoutMs` in `docture.config.ts` for a per-stage deadline.

The public `runPipeline()` function also enforces `timeoutMs`. Deadlines keep standalone Node calls alive until they settle and reject late splitter results. `review --timeout` includes reading source bytes. CLI commands validate the flag before configuration or resource setup, including dry runs.

A `timeoutMs` or `stageTimeoutMs` above 2147483647 ms, the longest delay `setTimeout` accepts, sets no timer, including in `review`. Before, the runtime clamped it to 1 ms and the stage or call timed out at once.
