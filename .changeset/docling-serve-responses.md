---
"docture": minor
---

Import real docling-serve 1.38.2 responses. The Docling importer reads list-item charspans from `orig`, accepts the space or removed hyphen that docling leaves between joined text boxes, and keeps the text of overlapping table cells with an `OVERLAPPING_TABLE_CELLS` diagnostic. The default `limits.maxNodes` rises from 100,000 to 2,500,000, and every limit error names the limit, its value, and the option that raises it. Async Docling jobs no longer count queue time against `jobTimeoutMs`: the new `queueTimeoutMs` bounds queued time, and `maxPolls` now defaults to cover both deadlines. `DoclingServeClient.health()` checks docling-serve's `/health` route before a batch.
