# OCR geometry fixtures

Raw engine output for pages of a synthetic two-column article and invoice. Each page
was scanned at 200 DPI (`flatscan`), or scanned and tilted 0.8 degrees (`scan`), then
rendered at 300 DPI as the OCR loaders render a PDF. `*.truth.json` holds each
document's headings, paragraphs and table.

- `*.tesseract.json`: tesseract.js 7 (`eng`, `--psm 3`) output as
  `blocks[block][paragraph][line]`, each line with `row: [rowHeight, ascenders, descenders]`
  and words as `[text, x0, y0, x1, y1, confidence]` in pixels.
- `*.paddle.json`: ppu-paddle-ocr 6.3 v6 Small regions as
  `[text, x, y, width, height, confidence]` in pixels, at the default padding.
