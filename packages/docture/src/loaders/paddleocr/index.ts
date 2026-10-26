/**
 * docture/loaders/paddleocr — a `DocumentLoader` that reads a document by
 * recognizing its pixels, backed by PaddleOCR's ONNX models via ppu-paddle-ocr.
 *
 * ```ts
 * import { createExtractor } from "docture";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 * import { NapiCanvasRasterizer } from "docture/raster/canvas";
 * import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
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
 * text — see the note on wiring in `DocumentLoaderPaddleOcr`.
 */


export { DocumentLoaderPaddleOcr } from "./loader.js";
export type { DocumentLoaderPaddleOcrOptions } from "./loader.js";

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
