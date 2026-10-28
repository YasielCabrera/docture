---
"docture": minor
---

Repeat a continuing table's header in multi-request text extraction. Under `paginate` and `concatenate`, a request that starts on a page whose rows continue a table from an earlier page now begins with `Table header continued from page N:`, the flattened header row, and a line marking it as context. The header comes from the conversion table analysis over positioned lines, counts against `maxCharsPerRequest`, carries no citation line ids, and is part of the response cache key. Documents without positioned lines and `forbidden` requests are sent unchanged. `chunkByPage` and `chunkByBudget` accept an optional `ChunkContext` function for the same purpose.
