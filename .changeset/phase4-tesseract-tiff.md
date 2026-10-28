---
"docture": minor
---

Read single- and multi-page TIFF with `DocumentLoaderTesseract`. Each image file directory becomes one page in file order, and `maxPages` and requested pages apply before recognition. Classic TIFF in either byte order is supported with no compression, LZW, PackBits, or CCITT Group 3 or Group 4, up to 8192 x 8192 pixels per page. Malformed TIFF, other compressions, such as Deflate, and larger pages reject before recognition, including TIFF bytes labelled PNG or JPEG. `page.image()` on a TIFF page returns PNG. `imageSize()` now sizes TIFF, and the new `tiffPages()` export lists the pages of a classic TIFF. It rejects files whose IFDs overlap, and pages whose layout would make a decoder allocate far more than the page needs: more than 64 bits per pixel, zero rows per strip, tiles that leave pixels uncovered or exceed both the page and 1024 x 1024 pixels, and camera-raw layouts.
