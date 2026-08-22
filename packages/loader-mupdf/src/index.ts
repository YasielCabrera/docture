/**
 * @docture/loader-mupdf — a `DocumentLoader` and a `Rasterizer`, both backed by MuPDF
 * compiled to WASM.
 *
 * One package because it is one dependency: MuPDF reads text and renders pages, and it
 * instantiates a single WASM engine that both classes share. They are still two plugins,
 * so either can be swapped for another library on its own.
 *
 * ```ts
 * import { createExtractor, withRasterizer } from "@docture/core";
 * import { DocumentLoaderMuPdf, MuPdfRasterizer } from "@docture/loader-mupdf";
 *
 * const extractor = createExtractor({
 *   loaders: [withRasterizer(new DocumentLoaderMuPdf(), new MuPdfRasterizer({ dpi: 300 }))],
 *   strategies: [...],
 * });
 * ```
 */

export { MuPdfLoader as DocumentLoaderMuPdf } from "./loader.js";
export type { MuPdfLoaderOptions as MuPdfConfig } from "./loader.js";

/**
 * The library-first spelling, kept as an alias.
 *
 * `DocumentLoaderMuPdf` is the primary name — every loader in this library reads
 * `DocumentLoader<Library>`, so a list of them lines up and the prefix says what
 * kind of thing it is. `MuPdfLoader` says the same thing in the other order.
 */
export { MuPdfLoader } from "./loader.js";
export type { MuPdfLoaderOptions } from "./loader.js";
export { MuPdfRasterizer, muPdfRasterizer } from "./rasterizer.js";
export type { MuPdfRasterizerOptions } from "./rasterizer.js";
