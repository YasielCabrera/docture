/**
 * Page rendering, as its own vocabulary.
 *
 * Rasterization is a SEPARATE concern from reading text. Folding it into the loader
 * would mean choosing an OCR engine also chooses how pages get rendered. Here they
 * are independent: a `MuPdfRasterizer` can feed a `DocumentLoaderTesseract`.
 */

export type RasterFormat = "png" | "jpeg";

export interface RasterOptions {
  /** Render resolution. 300 is the usual floor for OCR accuracy. */
  readonly dpi?: number;
  readonly format?: RasterFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  readonly quality?: number;
  /** Cap the long edge in pixels, downscaling if needed. Vision models want this. */
  readonly maxEdge?: number;
  /** 1-based page numbers to render. Omit for all pages. */
  readonly pages?: readonly number[];
}

export const DEFAULT_RASTER_OPTIONS = {
  dpi: 300,
  format: "png",
} as const satisfies RasterOptions;

export interface RasterPage {
  /** 1-based. */
  readonly pageNumber: number;
  readonly bytes: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly format: RasterFormat;
  /** Points-per-pixel, so a consumer can map pixel boxes back to PDF points. */
  readonly scale: number;
}
