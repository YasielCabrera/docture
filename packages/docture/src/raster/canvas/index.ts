/**
 * docture/raster/canvas — render PDF pages with pdf.js onto @napi-rs/canvas.
 *
 * ```ts
 * import { withRasterizer } from "docture";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 * import { NapiCanvasRasterizer } from "docture/raster/canvas";
 *
 * const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 300 }));
 * ```
 */

export { NapiCanvasRasterizer, napiCanvasRasterizer } from "./rasterizer.js";
export type { NapiCanvasRasterizerOptions } from "./rasterizer.js";
