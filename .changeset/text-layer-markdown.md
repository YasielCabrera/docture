---
"docture": patch
---

Convert PDF.js and MuPDF text layers to readable Markdown. Wrapped lines of one paragraph, list item, title, or code listing now form one element instead of one paragraph per line, and code keeps its indentation. A Courier font counts as code even when MuPDF reports it as proportional. Headings are measured against the font size of most of the page's characters outside table rows, so diagram labels and small-print tables no longer turn body text into headings. A numbered line set larger than the body, such as `2. Transactions`, is a heading. Ordered lists keep their original numbers and delimiters in Markdown, and HTML sets `start` when a list does not begin at 1. Markdown escapes a leading `#`, `+`, `-`, number, or underline on every line of paragraph text.
