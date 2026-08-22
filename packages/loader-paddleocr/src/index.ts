/**
 * @docture/loader-paddleocr — a `DocumentLoader` that reads a document by
 * recognizing its pixels, backed by PaddleOCR's ONNX models via ppu-paddle-ocr.
 *
 * ```ts
 * import { createExtractor } from "@docture/core";
 * import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
 * import { NapiCanvasRasterizer } from "@docture/raster-canvas";
 * import { DocumentLoaderPaddleOcr } from "@docture/loader-paddleocr";
 *
 * const extractor = createExtractor({
 *   loaders: [
 *     new DocumentLoaderPdfJs(),      // PDFs: the text layer, when there is one
 *     new DocumentLoaderPaddleOcr(),  // PNG/JPEG: recognize the pixels
 *   ],
 *   strategies: [...],
 * });
 *
 * // For a scanned PDF, OCR needs a way to turn its pages into pixels:
 * new DocumentLoaderPaddleOcr({ rasterizer: new NapiCanvasRasterizer() });
 * ```
 *
 * Loader choice is by media type and then declaration order, NOT a fallback on empty
 * text — see the note on wiring in `PaddleOcrLoader`.
 */

export { PaddleOcrLoader as DocumentLoaderPaddleOcr } from "./loader.js";
export type { PaddleOcrLoaderOptions as PaddleOcrConfig } from "./loader.js";

/**
 * The library-first spelling, kept as an alias.
 *
 * `DocumentLoaderPaddleOcr` is the primary name — every loader in this library reads
 * `DocumentLoader<Library>`, so a list of them lines up and the prefix says what
 * kind of thing it is. `PaddleOcrLoader` says the same thing in the other order.
 */
export { PaddleOcrLoader } from "./loader.js";
export type { PaddleOcrLoaderOptions } from "./loader.js";

/**
 * A value, not just a type, because "which models can I run?" is a question worth
 * being able to answer at run time — a CLI flag, or a picker. `strategy` and
 * `imageEngine` are string literals you write once, so those stay types only.
 */
export { PADDLE_MODELS } from "./paddle.js";
export type {
  ImageEngine,
  ModelSource,
  PaddleModel,
  PaddleModelFiles,
  RecognitionStrategy,
} from "./paddle.js";
