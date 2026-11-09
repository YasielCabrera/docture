---
"docture": minor
---

Breaking change: `Process.dispose()` no longer disposes the extractor passed to `loadExtractor()`. The process borrows it, so dispose the extractor through its owner. `Process` also supports `await using`.
