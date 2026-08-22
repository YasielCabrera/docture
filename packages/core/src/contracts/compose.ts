/**
 * Composing a loader with a rasterizer.
 *
 * This is the seam that keeps "which library reads text" and "which library renders
 * pages" independent while still letting a strategy demand both. `PdfJsLoader` does
 * not render; `MuPdfRasterizer` does not read; together they are a loader that does
 * both — and the RETURN TYPE says so, so an image-requiring strategy accepts the
 * composition and rejects the bare loader.
 *
 * ```ts
 * const loader = withRasterizer(new PdfJsLoader(), new MuPdfRasterizer({ dpi: 300 }));
 * //    ^? DocumentLoader<LoaderCapabilities<true, true, true>>
 * ```
 */

import type { RawDocument } from "../domain/document.js";
import type { LoadedDocument, LoadedPage } from "../domain/geometry.js";
import type { RasterOptions } from "../domain/raster.js";
import { DEFAULT_RASTER_OPTIONS } from "../domain/raster.js";
import type { DocumentLoader, LoaderCapabilities } from "./loader.js";
import type { Rasterizer } from "./rasterizer.js";

/** Same text and geometry as the wrapped loader; `images` is now `true`. */
export type WithImages<C extends LoaderCapabilities> = LoaderCapabilities<
  C["text"],
  C["geometry"],
  true
>;

export interface WithRasterizerOptions {
  /** Defaults applied to every `page.image()` call. Overridable per call. */
  readonly defaults?: RasterOptions;
}

/**
 * Attach lazy page rendering to a loader.
 *
 * Each `page.image()` renders THAT page only, and memoizes per distinct set of
 * options — so asking twice costs once, while a 200-page document that nobody looks
 * at costs nothing. To render many pages at once, call the rasterizer directly;
 * this path is for the strategy that wants page 4 and no others.
 */
export function withRasterizer<C extends LoaderCapabilities>(
  loader: DocumentLoader<C>,
  rasterizer: Rasterizer,
  options: WithRasterizerOptions = {},
): DocumentLoader<WithImages<C>> {
  const capabilities = {
    ...loader.capabilities,
    images: true,
  } as unknown as WithImages<C>;

  return {
    name: `${loader.name}+${rasterizer.name}`,
    capabilities,

    async load(document: RawDocument, ctx): Promise<LoadedDocument> {
      const loaded = await loader.load(document, ctx);
      const cache = new Map<string, Promise<Uint8Array>>();

      const pages: LoadedPage[] = loaded.pages.map((page) => ({
        ...page,
        image: (callOptions?: RasterOptions): Promise<Uint8Array> => {
          const merged: RasterOptions = {
            ...DEFAULT_RASTER_OPTIONS,
            ...options.defaults,
            ...callOptions,
            pages: [page.pageNumber],
          };
          // The page number MUST be in the key. The cache is shared across every
          // page of the document, so keying on render options alone made page 2
          // return page 1's image — silently, and identically for every page.
          const key = JSON.stringify([
            page.pageNumber,
            merged.dpi,
            merged.format,
            merged.quality,
            merged.maxEdge,
          ]);

          let pending = cache.get(key);
          if (pending === undefined) {
            pending = rasterizer
              .rasterize(document, merged, { signal: ctx.signal, logger: ctx.logger })
              .then((rendered) => {
                const first = rendered[0];
                if (first === undefined) {
                  throw new Error(
                    `${rasterizer.name} rendered no image for page ${page.pageNumber}.`,
                  );
                }
                return first.bytes;
              });
            cache.set(key, pending);
          }
          return pending;
        },
      }));

      return { ...loaded, pages };
    },

    async dispose(): Promise<void> {
      // Both, and report both failures — the composition owns what it wrapped.
      const results = await Promise.allSettled([loader.dispose?.(), rasterizer.dispose?.()]);
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Composed loader failed to dispose cleanly.");
      }
    },
  };
}
