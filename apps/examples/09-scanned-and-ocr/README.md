# 09-scanned-and-ocr — Scanned documents and OCR

> the no-text-layer diagnosis, OCR as a loader, two OCR engines, vision, where the rasterizer goes, multi-page TIFF.

**Needs:** `pnpm run fetch`. The diagnosis runs with no key. OCR is behind `RUN_OCR=1`; vision needs `AI_GATEWAY_API_KEY`.

```sh
pnpm --filter @docture/examples scanned
```

Docs: [`guides/scanned-documents`](../../docs/content/docs/guides/scanned-documents.mdx)

```sh
pnpm --filter @docture/examples scanned              # the diagnosis
RUN_OCR=1 pnpm --filter @docture/examples scanned    # + real OCR
```

OCR is opt-in because the first run downloads a WASM engine and language models — tens of
megabytes — which is not something `pnpm offline` should pay for. This matches the
`RUN_OCR=1` convention in `packages/docture/test/loaders/tesseract/`.

## Imports and installs

OCR loaders come from `docture/loaders/tesseract` and `docture/loaders/paddleocr`.
Rasterizers come from `docture/loaders/mupdf` and `docture/raster/canvas`. Vision
comes from `docture/llm/vision`, also re-exported by `docture/llm`. Install the engines
you choose explicitly. To use every path in a separate application:

```sh
pnpm add docture ai@^7.0.0 pdfjs-dist@6.2.108 mupdf@1.28.0 tesseract.js@7.0.0 ppu-paddle-ocr@6.3.0 onnxruntime-node@1.27.0 @napi-rs/canvas@1.0.10 utif2@4.1.0 zod
```

The tour workspace already installs these dependencies. See the
[workspace setup](../README.md) before running this folder.

## Be honest about the fixture

`scan-services.png` is a **1700×2200 clean render** of an invoice we also have as a PDF.
No skew, no sensor noise, no JPEG artifacts. OCR does better here than it will on
something somebody scanned at an angle on a Tuesday. **Treat the numbers below as a
ceiling.**

Finding a licence-clear, stably-hosted *real* scan is open work. What this fixture does
give you honestly is the "no text layer" case, and the pairing below.

## The payoff: one document, two paths, the same answer key

```
path                        loader          F1 vs published truth
the PDF's text layer        pdfjs                           0.750
OCR on the page image       tesseract                       0.750
```

Same document, same published ground truth, two completely different ways of reading it.
And the thing to notice in the code: **the strategy does not change.**

```ts
new Extractor()
  .loadDocumentLoader(new DocumentLoaderTesseract())   // accepts image/png
  .loadStrategy(servicesInvoiceParser())               // unchanged!
```

That is the whole argument for OCR being a **loader** rather than a strategy. Once pixels
have become text and geometry — through the same `linesFromWords` grouper a text layer
goes through — every parser you already wrote works on them.

(0.750 rather than 1.0 because our parser reads the letterhead as "Sammy Maystone" and the
published truth says "Sammy Maystone - For Lines testing". A real near-miss, and exactly
what `stringSimilarity` is for. Example 12.)

## Two engines, one interface

```
loader            text recovered    geometry            wall
tesseract         626 chars         27 lines          756 ms
paddleocr         629 chars         27 lines         1196 ms
```

Swapping engines is swapping an import.

## Where the rasterizer goes

A bare page image is one case. The common one is a PDF whose pages are pictures, and then
OCR needs a way to turn those pages into pixels — a **constructor argument**, not
something discovered on page 40:

```ts
.loadDocumentLoader(
  new DocumentLoaderPdfJs(),                    // PDFs with a text layer
  new DocumentLoaderTesseract({ rasterizer }),  // PNG/JPEG/TIFF in this wiring
)
```

Loader choice is by media type and then declaration order — **never** a fallback on empty
text. PDF.js remains the selected loader for PDFs, including scans. In this wiring Tesseract
handles standalone PNG, JPEG, and TIFF images. For scanned PDFs, choose
`new DocumentLoaderTesseract({ rasterizer })` as the PDF loader or retry with an OCR
extractor after inspecting the text-layer result.

## What to read next

[`10-classification`](../10-classification) — what kind of document is this?
