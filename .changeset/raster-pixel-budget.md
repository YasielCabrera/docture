---
"docture": patch
---

`NapiCanvasRasterizer` and `MuPdfRasterizer` cap a page at 40 megapixels by default and lower the DPI to fit, so an oversized page no longer allocates gigabytes. Set `maxPixels` to a number of at least 1 to change the cap, or to `Infinity` to turn it off. Page images keep the eight most recently used renders per document instead of every render.
