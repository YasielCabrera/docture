---
"docture": patch
---

`PageSelectionError` no longer blames the document for a limit it did not set. A page past a loader's `maxPages` limit says so, as in "Page 5 is outside the first 3 pages that maxPages allows. The document has 10 pages.", and the error carries `maxPages`. A selected page missing from the pages a loader returned now says "Page 5 was not loaded. The loaded pages are 1-3." instead of stating a document length the pipeline does not know, and the error carries `loadedPages`.
