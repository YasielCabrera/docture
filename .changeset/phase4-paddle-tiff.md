---
"docture": minor
---

Read single- and multi-page TIFF with `DocumentLoaderPaddleOcr`. Install the new optional peer `utif2@4.1.0`; the loader imports it only for TIFF input and reports `MISSING_ENGINE` when it is absent. Each selected page is decoded to PNG before the engine sees it, so TIFF bytes never reach the native image decoder, and `page.image()` returns that PNG. Classic TIFF in either byte order is supported with no compression, LZW, Deflate, PackBits, or CCITT Group 3 or Group 4, up to 8192 x 8192 pixels per page. Malformed TIFF, other compressions, and larger pages reject before decoding or recognition, as do layouts that would make the decoder allocate more than the page needs, such as a tile far larger than its page. Decoding writes nothing to stdout. Pages decode one at a time with abort checks between them, the decoder never follows sub-IFD, Exif, or GPS links, and TIFF bytes labelled PNG or JPEG are read as TIFF.
