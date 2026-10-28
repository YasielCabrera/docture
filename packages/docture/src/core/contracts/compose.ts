/**
 * Composing a loader with a rasterizer.
 *
 * This is the seam that keeps "which library reads text" and "which library renders
 * pages" independent while still letting a strategy demand both. `DocumentLoaderPdfJs` does
 * not render; `MuPdfRasterizer` does not read; together they are a loader that does
 * both — and the RETURN TYPE says so, so an image-requiring strategy accepts the
 * composition and rejects the bare loader.
 *
 * ```ts
 * const loader = withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer({ dpi: 300 }));
 * //    ^? DocumentLoader<LoaderCapabilities<true, true, true>>
 * ```
 */

import { createDisposalScope, type DisposalScope } from "./disposal.js";
import type { RawDocument } from "../domain/document.js";
import type { LoadedDocument, LoadedPage } from "../domain/geometry.js";
import type { RasterOptions } from "../domain/raster.js";
import type { DocumentLoader, LoaderCapabilities } from "./loader.js";
import { pageImageRenderer } from "./page-images.js";
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
): DocumentLoader<WithImages<C>> & AsyncDisposable & { dispose(scope?: DisposalScope): Promise<void> } {
  const capabilities = {
    ...loader.capabilities,
    images: true,
  } as unknown as WithImages<C>;

  let disposed: Promise<void> | undefined;
  return {
    name: `${loader.name}+${rasterizer.name}`,
    capabilities,

    async load(document: RawDocument, ctx): Promise<LoadedDocument> {
      disposed = undefined;
      const loaded = await loader.load(document, ctx);
      const render = pageImageRenderer(rasterizer, document, ctx);
      const pages: LoadedPage[] = loaded.pages.map((page) => ({
        ...page,
        image: (callOptions?: RasterOptions, call?: { readonly signal?: AbortSignal }) =>
          render(page.pageNumber, { ...options.defaults, ...callOptions }, call?.signal),
      }));

      return { ...loaded, pages };
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.dispose();
    },

    dispose(scope: DisposalScope = createDisposalScope()): Promise<void> {
      disposed ??= scope.dispose(loader, rasterizer);
      return disposed;
    },
  };
}
