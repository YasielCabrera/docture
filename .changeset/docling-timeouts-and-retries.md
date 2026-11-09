---
"docture": patch
---

Docling's synchronous `convert()` is bounded by the new `convertTimeoutMs` (default `jobTimeoutMs`) rather than the 30 second request timeout. Retried GETs back off exponentially with jitter and honor `Retry-After`. A retry wait that would outlast the request deadline is skipped, so the caller gets the HTTP status and detail instead of a timeout. HTTP errors include a bounded excerpt of Docling's `detail`.
