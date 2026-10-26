/**
 * docture/loaders/mupdf — a `DocumentLoader` and a `Rasterizer`, both backed by MuPDF
 * compiled to WASM.
 *
 * One package because it is one dependency: MuPDF reads text and renders pages, and it
 * instantiates a single WASM engine that both classes share. They are still two plugins,
 * so either can be swapped for another library on its own.
 *
 * ```ts
 * import { createExtractor, withRasterizer } from "docture";
 * import { DocumentLoaderMuPdf, MuPdfRasterizer } from "docture/loaders/mupdf";
 *
 * const extractor = createExtractor({
 *   loaders: [withRasterizer(new DocumentLoaderMuPdf(), new MuPdfRasterizer({ dpi: 300 }))],
 *   strategies: [...],
 * });
 * ```
 */


export { DocumentLoaderMuPdf } from "./loader.js";
export type { DocumentLoaderMuPdfOptions } from "./loader.js";
export { MuPdfRasterizer, muPdfRasterizer } from "./rasterizer.js";
export type { MuPdfRasterizerOptions } from "./rasterizer.js";
