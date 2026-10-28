---
"docture": patch
---

Conversion now recognizes a running page number printed just below the top margin band or just above the bottom one, such as `Page 2 of 6` at 12% from the top of a statement. Between 10% and 15% of the page, a line becomes a `page-header` or `page-footer` with `evidence: "repeated"` only when it is page-number text that follows the pages, keeps one height and indent on at least three pages and 60% of them, and has a line of blank space between it and the body. Markdown and HTML leave it out; TXT and JSON keep it. The general band stays at 10%, so other repeated text in that region, and a page number at another height, stays in the body.
