---
"docture": minor
---

Add the `docture/chunk` entry with `chunkDocument()`, which splits a conversion result or a saved JSON document into retrieval chunks of whole elements. Each `DocumentChunk` has a stable `id`, Markdown `text`, `elementIds`, and the `provenance` segments (page, box, source and line IDs) of its elements. The budget counts characters or estimated tokens (`estimateTokens()`, `ceil(characters / 4)`) and is soft in one case only: a chunk exceeds it when it holds a single element, or one table row group with its header rows, that is larger than the budget with its heading path. Headings start new chunks, and `headingPath: true` prefixes the headings above each chunk. A table larger than the budget splits between rows, keeps row-span groups together, repeats its header rows in every piece, and cites only its rows' pages. Body text is never repeated unless `overlapElements` asks for it, and a repeat that would exceed the budget is dropped.
