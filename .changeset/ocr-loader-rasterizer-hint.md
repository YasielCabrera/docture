---
"docture": patch
---

A PDF given to `DocumentLoaderTesseract` or `DocumentLoaderPaddleOcr` without a `rasterizer` now fails with a `NO_ELIGIBLE_LOADER` reason that says to pass one. Loaders can declare such reasons with the new `capabilities.declines` map.
