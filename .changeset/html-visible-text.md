---
"docture": patch
---

Extract visible HTML and XHTML text in DocumentLoaderData. Drop scripts, styles, templates, noscript, head content and comments. Preserve block order, heading and list hints, table cells and decoded entities on one page.

Use lazy standards-aware HTML parsing and an XML fragment parser for XHTML. Preserve omitted head/body markup, complete character references, textarea text and literal CDATA without fetching external resources.
