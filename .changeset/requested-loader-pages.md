---
"docture": minor
---

Pass requested page numbers to loaders before parsing and OCR. Built-in adapters read only the selected pages and preserve original numbering. Custom loaders may ignore the optional hint, with pipeline projection preserving correctness.

Breaking change for custom rasterizers that return sparse pages. OCR maxPages caps original page numbers rather than the number of returned rasters.
