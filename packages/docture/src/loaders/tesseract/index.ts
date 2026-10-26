/**
 * docture/loaders/tesseract — a `DocumentLoader` that reads a document by
 * recognizing its pixels, backed by tesseract.js (Tesseract as WASM, no binary).
 *
 * ```ts
 * import { createExtractor } from "docture";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 * import { NapiCanvasRasterizer } from "docture/raster/canvas";
 * import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
 *
 * const extractor = createExtractor({
 *   loaders: [
 *     new DocumentLoaderPdfJs(),        // PDFs: the text layer, when there is one
 *     new DocumentLoaderTesseract(),  // PNG/JPEG: recognize the pixels
 *   ],
 *   strategies: [...],
 * });
 *
 * // For a scanned PDF, OCR needs a way to turn its pages into pixels:
 * new DocumentLoaderTesseract({ rasterizer: new NapiCanvasRasterizer() });
 * ```
 *
 * Loader choice is by media type and then declaration order, NOT a fallback on empty
 * text — see the note on wiring in `DocumentLoaderTesseract`.
 */


export { DocumentLoaderTesseract } from "./loader.js";
export type { DocumentLoaderTesseractOptions } from "./loader.js";
export type { PageSegmentation } from "./tesseract.js";
