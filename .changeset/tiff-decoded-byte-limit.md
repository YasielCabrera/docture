---
"docture": patch
---

The Tesseract and PaddleOCR loaders refuse a TIFF page whose samples decode to more than 256 MiB, such as a 16-bit RGBA page at 8192 x 8192, before decoding it. PaddleOCR inflates a Deflate page once instead of twice and converts pages to PNG in bands of rows, which lowers peak memory: decoding an 8192 x 8192 8-bit RGBA Deflate page fell from 1650 MB to 632 MB maximum resident set on Node 24.
