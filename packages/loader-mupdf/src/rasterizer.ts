/**
 * `MuPdfRasterizer` — render PDF pages to PNG/JPEG with MuPDF compiled to WASM.
 *
 * The alternative in this repo, `NapiCanvasRasterizer`, is pdf.js drawing onto a native
 * canvas binding. This one has no native code at all: MuPDF rasterizes inside WASM and
 * encodes the image itself, so there is no prebuilt binary to match to your platform.
 *
 * It is a rasterizer and nothing else, even though the same dependency can also read
 * text. That is the seam: `MuPdfRasterizer` can render for a `TesseractJsLoader`, and
 * `MuPdfLoader` can be rendered by `NapiCanvasRasterizer`. Neither choice forces the
 * other.
 */

import {
  DEFAULT_RASTER_OPTIONS,
  defineRasterizer,
  type RasterFormat,
  type RasterOptions,
  type RasterPage,
  type RasterizeContext,
  type Rasterizer,
  type RawDocument,
} from "@docture/core";
import { loadMuPdf, openDocument, withMuPdfLog } from "./mupdf.js";

export interface MuPdfRasterizerOptions {
  /** Applied when a call does not say otherwise. */
  readonly dpi?: number;
  readonly format?: RasterFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  readonly quality?: number;
  /** Cap the long edge in pixels. A vision model rarely wants more than ~2000. */
  readonly maxEdge?: number;
  /** Password for an encrypted PDF. */
  readonly password?: string;
  /**
   * Include annotations and form-field appearances. Default `true` — a filled-in form
   * whose values live in its widgets would otherwise render blank, which is exactly the
   * document someone reaches for a vision model to read.
   */
  readonly annotations?: boolean;
}

/**
 * The scale that honours both `dpi` and `maxEdge`.
 *
 * `dpi` asks for a resolution; `maxEdge` caps the result. When they conflict the cap
 * wins, because the caller who set it did so to fit a downstream limit (a model's image
 * budget, a memory ceiling) that overshooting would breach.
 */
function resolveScale(
  widthPt: number,
  heightPt: number,
  dpi: number,
  maxEdge: number | undefined,
): number {
  const fromDpi = dpi / 72;
  const longEdgePt = Math.max(widthPt, heightPt);
  if (maxEdge === undefined || longEdgePt * fromDpi <= maxEdge) return fromDpi;
  // MuPDF rounds a page's pixel box OUTWARD, so `maxEdge / longEdge` lands on the cap
  // exactly — unless the float product comes back a hair above it, which would ceil to
  // one pixel over. Aiming a nanometre under costs no pixel and makes the cap a promise.
  return (maxEdge - 1e-9) / longEdgePt;
}

export class MuPdfRasterizer implements Rasterizer {
  readonly name = "mupdf";
  readonly formats = ["png", "jpeg"] as const satisfies readonly RasterFormat[];

  constructor(private readonly options: MuPdfRasterizerOptions = {}) {}

  async rasterize(
    document: RawDocument,
    options: RasterOptions,
    ctx: RasterizeContext,
  ): Promise<readonly RasterPage[]> {
    ctx.signal.throwIfAborted();
    const mupdf = await loadMuPdf();

    const dpi = options.dpi ?? this.options.dpi ?? DEFAULT_RASTER_OPTIONS.dpi;
    const format = options.format ?? this.options.format ?? DEFAULT_RASTER_OPTIONS.format;
    const quality = options.quality ?? this.options.quality ?? 0.9;
    const maxEdge = options.maxEdge ?? this.options.maxEdge;
    const annotations = this.options.annotations ?? true;

    return withMuPdfLog(ctx.logger, () => {
      const pdf = openDocument(mupdf, document.bytes, this.options.password);
      try {
        const pageCount = pdf.countPages();
        const wanted = options.pages ?? Array.from({ length: pageCount }, (_unused, i) => i + 1);
        const rendered: RasterPage[] = [];

        for (const pageNumber of wanted) {
          // A MuPDF render is one blocking WASM call, so this loop never yields and the
          // signal cannot change once it starts. The check catches an abort that landed
          // while the engine was loading above.
          ctx.signal.throwIfAborted();
          if (pageNumber < 1 || pageNumber > pageCount) {
            throw new Error(`Page ${pageNumber} is out of range; the document has ${pageCount}.`);
          }

          const page = pdf.loadPage(pageNumber - 1);
          try {
            const [x0, y0, x1, y1] = page.getBounds();
            const widthPt = x1 - x0;
            const heightPt = y1 - y0;
            const scale = resolveScale(widthPt, heightPt, dpi, maxEdge);

            const pixmap = page.toPixmap(
              mupdf.Matrix.scale(scale, scale),
              mupdf.ColorSpace.DeviceRGB,
              // `alpha: false` is what makes the background WHITE. With alpha the page
              // comes back transparent-black, which a JPEG cannot carry and a vision
              // model reads as an inverted page.
              false,
              annotations,
            );
            try {
              const widthPx = pixmap.getWidth();
              const heightPx = pixmap.getHeight();

              rendered.push({
                pageNumber,
                // Already a copy out of the WASM heap — MuPDF's encoders slice their
                // output buffer — so these bytes outlive the pixmap below.
                bytes:
                  format === "jpeg"
                    ? // MuPDF takes JPEG quality as 0–100.
                      pixmap.asJPEG(Math.round(quality * 100), false)
                    : pixmap.asPNG(),
                widthPx,
                heightPx,
                format,
                // Points per pixel, computed from what we actually produced — so it
                // stays correct after a maxEdge downscale and after MuPDF's rounding.
                scale: widthPt / widthPx,
              });
            } finally {
              pixmap.destroy();
            }
          } finally {
            page.destroy();
          }
        }

        return rendered;
      } finally {
        pdf.destroy();
      }
    });
  }
}

/**
 * Functional form, for wiring that prefers it. Identical behaviour — the class is the
 * documented entry point.
 */
export function muPdfRasterizer(options: MuPdfRasterizerOptions = {}): Rasterizer {
  return defineRasterizer(new MuPdfRasterizer(options));
}
