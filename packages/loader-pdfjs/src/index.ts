/**
 * @docture/loader-pdfjs — a `DocumentLoader` backed by pdfjs-dist (Mozilla PDF.js).
 *
 * ```ts
 * import { createExtractor } from "@docture/core";
 * import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
 *
 * const extractor = createExtractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [...] });
 * ```
 */

export { PdfJsLoader as DocumentLoaderPdfJs } from "./loader.js";
export type { PdfJsLoaderOptions as PdfJsConfig } from "./loader.js";

/**
 * The library-first spelling, kept as an alias.
 *
 * `DocumentLoaderPdfJs` is the primary name — every loader in this library reads
 * `DocumentLoader<Library>`, so a list of them lines up and the prefix says what
 * kind of thing it is. `PdfJsLoader` says the same thing in the other order.
 */
export { PdfJsLoader } from "./loader.js";
export type { PdfJsLoaderOptions } from "./loader.js";
