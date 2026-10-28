---
"docture": minor
---

Detect running headers and footers. Conversion marks lines that repeat in the top or bottom 10% of at least three pages, and tagged `header` and `footer` hints inside those bands, as `page-header` and `page-footer` elements. Page numbers that follow the page, such as `Page 2 of 9`, match across pages, and odd-page and even-page running heads are detected separately. Markdown and HTML leave them out of the body; TXT and JSON keep them. Layout analyzers no longer see them, and annotations that name them are ignored. `ConvertedPage` now reports the page `width` and `height`. The thresholds are heuristics and are documented in the core conversion reference.
