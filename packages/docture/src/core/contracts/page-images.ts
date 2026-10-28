import type { RawDocument } from "../domain/document.js";
import type { RasterOptions } from "../domain/raster.js";
import type { LoadContext } from "./loader.js";
import type { Rasterizer } from "./rasterizer.js";

interface SharedRender {
  readonly bytes: Promise<Uint8Array>;
  readonly controller: AbortController;
  waiting: number;
  settled: boolean;
}

export type PageImageRenderer = (
  pageNumber: number,
  options: RasterOptions,
  signal: AbortSignal | undefined,
) => Promise<Uint8Array>;

export function pageImageRenderer(
  rasterizer: Rasterizer,
  document: RawDocument,
  ctx: LoadContext,
): PageImageRenderer {
  const renders = new Map<string, SharedRender>();

  return (pageNumber, options, callSignal) => {
    const signal = callSignal ?? ctx.signal;
    if (signal.aborted) return Promise.reject(signal.reason);

    const merged: RasterOptions = { ...options, pages: [pageNumber] };
    const key = JSON.stringify([pageNumber, merged.dpi, merged.format, merged.quality, merged.maxEdge, merged.maxPages]);

    let render = renders.get(key);
    if (render === undefined) {
      const controller = new AbortController();
      const bytes = rasterizer
        .rasterize(document, merged, { signal: controller.signal, logger: ctx.logger })
        .then((rendered) => {
          const first = rendered[0];
          if (first === undefined) {
            throw new Error(`${rasterizer.name} rendered no image for page ${pageNumber}.`);
          }
          return first.bytes;
        });
      const created: SharedRender = { bytes, controller, waiting: 0, settled: false };
      bytes.then(
        () => { created.settled = true; },
        () => {
          created.settled = true;
          if (renders.get(key) === created) renders.delete(key);
        },
      );
      renders.set(key, created);
      render = created;
    }
    const shared = render;
    if (shared.settled) return shared.bytes;

    shared.waiting += 1;
    return new Promise<Uint8Array>((resolve, reject) => {
      const onAbort = (): void => {
        shared.waiting -= 1;
        if (shared.waiting === 0 && !shared.settled) {
          if (renders.get(key) === shared) renders.delete(key);
          shared.controller.abort(signal.reason);
        }
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener("abort", onAbort);
        onAbort();
        return;
      }
      shared.bytes.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };
}
