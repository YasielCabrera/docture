---
"docture": minor
"@docture/cli": minor
---

Make OCR reachable when converting scans.

- `DocumentConverter` tries the next eligible loader when a loader recovers no text from the selected pages, so an OCR loader listed after PDF.js reads a scanned PDF. The skipped loader appears in `attempts` with status `"skipped"`. Extraction keeps its current loader routing.
- `NoConvertibleContentError` now says how to OCR a scan, and names `withOcrFallback` for mixed documents.
- `withOcrFallback(primary, ocr)` no longer needs options. Pages with fewer than 20 characters of trimmed text go to OCR. The defaults are exported as `textLengthQuality` and `DEFAULT_OCR_THRESHOLD`.
- `ConversionResult.ocrFallback` reports which pages `withOcrFallback` sent to OCR, which loader supplied each page, and per-page OCR warnings. The versioned JSON output is unchanged.
- A disposed `DocumentConverter` rejects new conversions with `DisposedError` (`DISPOSED`), and a conversion in flight stops before it starts another loader or OCR page. Before, converting after `dispose()` started a new OCR worker pool that nothing released.
- `docture convert --ocr tesseract|paddleocr` rereads pages with too little text using that engine. A missing engine fails with its install command instead of an empty result.
