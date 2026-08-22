/**
 * The rasterizer contract — its own plugin type.
 *
 * Kept separate from {@link DocumentLoader} so that "which library renders pages"
 * and "which library reads them" are independent decisions. That is what lets a
 * MuPDF renderer feed a tesseract.js OCR pass.
 */

import type { RawDocument } from "../domain/document.js";
import type { Logger } from "../domain/logger.js";
import type { RasterOptions, RasterPage } from "../domain/raster.js";

export interface RasterizeContext {
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

export interface Rasterizer {
  /** Stable id, named after the library behind it (`mupdf`, `napi-canvas`). */
  readonly name: string;
  /** Output formats this rasterizer can produce. */
  readonly formats: readonly RasterPage["format"][];
  rasterize(
    document: RawDocument,
    options: RasterOptions,
    ctx: RasterizeContext,
  ): Promise<readonly RasterPage[]>;
  dispose?(): Promise<void>;
}

/** Identity helper, for symmetry with `defineLoader`. */
export function defineRasterizer(rasterizer: Rasterizer): Rasterizer {
  return rasterizer;
}
