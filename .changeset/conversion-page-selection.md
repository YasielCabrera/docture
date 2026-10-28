---
"docture": minor
"@docture/cli": minor
---

`convert`, `safeConvert`, and `convertBatch` accept `pages`, a list of original one-based page numbers. The converter copies the list when the call starts, asks the loader for only those pages, and keeps only those pages for preloaded sources and loaders that ignore the hint. Text, Markdown, HTML, and JSON results, features, and assets cover the selected pages and keep their original page numbers, and tables and paragraphs join only across consecutive original pages. An empty selection or a missing page throws `PageSelectionError` (`PAGE_OUT_OF_RANGE`), as extraction does.

The MCP `convert` tool accepts the same `pages` argument. Malformed pages are invalid parameters, and a page the document lacks fails the item with `PAGE_OUT_OF_RANGE`.
