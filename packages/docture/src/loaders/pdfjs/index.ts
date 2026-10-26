/**
 * docture/loaders/pdfjs — a `DocumentLoader` backed by pdfjs-dist (Mozilla PDF.js).
 *
 * ```ts
 * import { createExtractor } from "docture";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 *
 * const extractor = createExtractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [...] });
 * ```
 */


export { DocumentLoaderPdfJs } from "./loader.js";
export type { DocumentLoaderPdfJsOptions } from "./loader.js";
