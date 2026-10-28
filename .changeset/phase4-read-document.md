---
"docture": minor
---

Breaking change: rename `loadDocument` to `readDocument`. The parameters and return type are unchanged, and no `loadDocument` alias remains. Replace `loadDocument(loaders, raw, logger, signal, stageTimeoutMs)` with `readDocument(loaders, raw, logger, signal, stageTimeoutMs)`. The `load*` prefix now only names builder registration methods such as `loadDocumentLoader`.
