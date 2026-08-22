/**
 * @docture/loader-tesseract — a `DocumentLoader` that reads a document by
 * recognizing its pixels, backed by tesseract.js (Tesseract as WASM, no binary).
 *
 * ```ts
 * import { createExtractor } from "@docture/core";
 * import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
 * import { NapiCanvasRasterizer } from "@docture/raster-canvas";
 * import { DocumentLoaderTesseract } from "@docture/loader-tesseract";
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
 * text — see the note on wiring in `TesseractJsLoader`.
 */

export { TesseractJsLoader as DocumentLoaderTesseract } from "./loader.js";
export type { TesseractJsLoaderOptions as TesseractConfig } from "./loader.js";

/**
 * The library-first spelling, kept as an alias.
 *
 * `DocumentLoaderTesseract` is the primary name — every loader in this library reads
 * `DocumentLoader<Library>`, so a list of them lines up and the prefix says what
 * kind of thing it is. `TesseractJsLoader` says the same thing in the other order.
 */
export { TesseractJsLoader } from "./loader.js";
export type { TesseractJsLoaderOptions } from "./loader.js";
export type { PageSegmentation } from "./tesseract.js";
