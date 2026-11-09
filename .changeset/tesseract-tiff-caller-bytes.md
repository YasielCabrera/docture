---
"docture": patch
---

Tesseract no longer writes into the caller's Buffer, or into Node's shared buffer pool, when it reads page 2 or later of a multi-page TIFF.
