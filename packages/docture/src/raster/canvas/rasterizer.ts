/**
 * `NapiCanvasRasterizer` — render PDF pages to images with pdf.js drawing onto a
 * `@napi-rs/canvas` surface.
 *
 * Both libraries are named in the class name and both are loaded lazily, so a
 * pipeline that never renders a page pays neither pdf.js's startup nor the native
 * canvas binding's.
 *
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  DEFAULT_RASTER_OPTIONS,
  defineRasterizer,
  type RasterFormat,
  type RasterOptions,
  type RasterPage,
  type RasterizeContext,
  type Rasterizer,
  type RawDocument,
} from "../../core/index.js";
import { importEngine } from "../../core/engines.js";

export interface NapiCanvasRasterizerOptions {
  /** Applied when a call does not say otherwise. */
  readonly dpi?: number;
  readonly format?: RasterFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  readonly quality?: number;
  /** Cap the long edge in pixels. A vision model rarely wants more than ~2000. */
  readonly maxEdge?: number;
  /** Password for an encrypted PDF. */
  readonly password?: string;
}

interface CanvasSurface {
  toBuffer(mime: "image/png"): Buffer;
  toBuffer(mime: "image/jpeg", quality?: number): Buffer;
}

interface PdfJsRenderModule {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{
      readonly numPages: number;
      readonly canvasFactory: {
        create(width: number, height: number): {
          readonly canvas: CanvasSurface;
          readonly context: unknown;
        };
      };
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: Record<string, unknown>): { promise: Promise<void> };
        cleanup(): boolean;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

interface LoadedDeps {
  readonly pdfjs: PdfJsRenderModule;
  readonly standardFontDataUrl: string;
}

let deps: Promise<LoadedDeps> | undefined;

/**
 * Locate pdf.js's bundled standard fonts.
 *
 * A plain filesystem path with a trailing slash — NOT a `file://` URL. The option is
 * named `standardFontDataUrl`, but the Node build reads it through the filesystem and
 * Node's `fetch` cannot open `file://`; a URL makes every page log "Unable to load
 * font data" and render with guessed metrics.
 *
 */
function resolveStandardFonts(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const root = dirname(dirname(dirname(entry)));
  return `${join(root, "standard_fonts")}/`;
}

/** Both heavy dependencies, loaded on first render and cached thereafter. */
async function loadDeps(): Promise<LoadedDeps> {
  deps ??= (async () => {
    const [pdfjs] = await importEngine("docture/raster/canvas", ["pdfjs-dist", "@napi-rs/canvas"], () =>
      Promise.all([
        // The legacy build is required in Node — the default one touches DOMMatrix
        // at module scope.
        import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<unknown>,
        // Imported only to report a missing peer. Pages are drawn on pdf.js's own canvas.
        import("@napi-rs/canvas") as Promise<unknown>,
      ]),
    );
    return {
      pdfjs: pdfjs as PdfJsRenderModule,
      standardFontDataUrl: resolveStandardFonts(),
    };
  })();
  return deps;
}

/**
 * The scale that honours both `dpi` and `maxEdge`.
 *
 * `dpi` asks for a resolution; `maxEdge` caps the result. When they conflict the cap
 * wins, because the caller who set it did so to fit a downstream limit (a model's
 * image budget, a memory ceiling) that overshooting would breach.
 */
function resolveScale(
  widthPt: number,
  heightPt: number,
  dpi: number,
  maxEdge: number | undefined,
): number {
  const fromDpi = dpi / 72;
  if (maxEdge === undefined) return fromDpi;
  const longEdgePx = Math.max(widthPt, heightPt) * fromDpi;
  if (longEdgePx <= maxEdge) return fromDpi;
  return maxEdge / Math.max(widthPt, heightPt);
}

export class NapiCanvasRasterizer implements Rasterizer {
  readonly name = "napi-canvas";
  readonly formats = ["png", "jpeg"] as const satisfies readonly RasterFormat[];

  constructor(private readonly options: NapiCanvasRasterizerOptions = {}) {}

  async rasterize(
    document: RawDocument,
    options: RasterOptions,
    ctx: RasterizeContext,
  ): Promise<readonly RasterPage[]> {
    ctx.signal.throwIfAborted();
    const { pdfjs, standardFontDataUrl } = await loadDeps();

    const dpi = options.dpi ?? this.options.dpi ?? DEFAULT_RASTER_OPTIONS.dpi;
    const format = options.format ?? this.options.format ?? DEFAULT_RASTER_OPTIONS.format;
    const quality = options.quality ?? this.options.quality ?? 0.9;
    const maxEdge = options.maxEdge ?? this.options.maxEdge;

    const task = pdfjs.getDocument({
      // A copy: pdf.js detaches the buffer it is handed, and the caller may still
      // need theirs (a loader in the same chain, or a second render pass).
      data: new Uint8Array(document.bytes),
      standardFontDataUrl,
      isEvalSupported: false,
      useSystemFonts: false,
      ...(this.options.password === undefined ? {} : { password: this.options.password }),
    });

    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy().catch(() => {});
      throw new Error(`napi-canvas could not open the document: ${describe(error)}`, {
        cause: error,
      });
    }

    try {
      const wanted =
        options.pages ?? Array.from({ length: pdf.numPages }, (_unused, i) => i + 1);
      const rendered: RasterPage[] = [];

      for (const pageNumber of wanted) {
        ctx.signal.throwIfAborted();
        if (pageNumber < 1 || pageNumber > pdf.numPages) {
          throw new Error(
            `Page ${pageNumber} is out of range; the document has ${pdf.numPages}.`,
          );
        }

        const page = await pdf.getPage(pageNumber);
        try {
          const base = page.getViewport({ scale: 1 });
          const scale = resolveScale(base.width, base.height, dpi, maxEdge);
          const viewport = page.getViewport({ scale });

          const widthPx = Math.max(1, Math.floor(viewport.width));
          const heightPx = Math.max(1, Math.floor(viewport.height));
          // pdf.js draws with the Path2D of the canvas it resolved for itself, and a
          // context from another installed canvas rejects it. A package manager can
          // install a second canvas for pdf.js, so its own factory creates the surface.
          const surface = pdf.canvasFactory.create(widthPx, heightPx);

          await page.render({
            canvas: surface.canvas,
            canvasContext: surface.context,
            viewport,
          }).promise;

          const bytes =
            format === "jpeg"
              ? // @napi-rs/canvas takes JPEG quality as 0–100.
                surface.canvas.toBuffer("image/jpeg", Math.round(quality * 100))
              : surface.canvas.toBuffer("image/png");

          rendered.push({
            pageNumber,
            bytes: new Uint8Array(bytes),
            widthPx,
            heightPx,
            format,
            // Points per pixel, computed from what we actually produced — so it
            // stays correct after a maxEdge downscale.
            scale: base.width / widthPx,
          });
        } finally {
          page.cleanup();
        }
      }

      return rendered;
    } finally {
      await task.destroy().catch(() => {});
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Functional form, for wiring that prefers it. Identical behaviour — the class is
 * the documented entry point.
 */
export function napiCanvasRasterizer(options: NapiCanvasRasterizerOptions = {}): Rasterizer {
  return defineRasterizer(new NapiCanvasRasterizer(options));
}
