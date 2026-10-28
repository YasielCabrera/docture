---
"docture": minor
---

Model-call telemetry now names what each call actually covered. Layout analysis calls carry the source file name as `document`, honoring `documentLabel: false`, and `LayoutAnalyzerContext` gains an optional `documentLabel`. A classifier call lists only the pages with text in the excerpt it sent, with their original page numbers, and has no `pages` when a preloaded document's text cannot be traced to its pages.
