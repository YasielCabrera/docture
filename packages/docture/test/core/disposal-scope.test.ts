import { describe, expect, it, vi } from "vitest";
import { createDisposalScope, DocumentConverter, Extractor, silentLogger, withRasterizer, type DocumentLoader, type Rasterizer } from "docture";

function resources() {
  const releaseLoader = vi.fn(async () => {});
  const releaseRasterizer = vi.fn(async () => {});
  const loader = Object.freeze({
    name: "frozen-loader",
    capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
    async load() { return { pages: [], text: "", form: "scanned", loader: "frozen-loader" }; },
    dispose: releaseLoader,
  } satisfies DocumentLoader);
  const rasterizer = Object.freeze({
    name: "frozen-renderer",
    formats: ["png"],
    async rasterize() { return []; },
    dispose: releaseRasterizer,
  } satisfies Rasterizer);
  return { loader, rasterizer, releaseLoader, releaseRasterizer };
}

describe("shared disposal ownership", () => {
  it("disposes frozen resources shared through pipelines and compositions once without changing them", async () => {
    const { loader, rasterizer, releaseLoader, releaseRasterizer } = resources();
    const descriptor = Object.getOwnPropertyDescriptor(loader, "dispose");
    const composed = withRasterizer(loader, rasterizer);
    const extractor = new Extractor({ loaders: [composed] });
    const converter = new DocumentConverter({ loaders: [loader] });
    const scope = createDisposalScope();

    await Promise.all([scope.dispose(extractor, converter), scope.dispose(loader, rasterizer)]);
    await scope.dispose(extractor, converter, composed, loader, rasterizer);

    expect(releaseLoader).toHaveBeenCalledTimes(1);
    expect(releaseRasterizer).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(loader, "dispose")).toEqual(descriptor);
    expect(Object.isFrozen(loader)).toBe(true);
  });

  it("settles every resource and retains failed disposal within the same scope", async () => {
    const failed = vi.fn(async () => { throw new Error("release failed"); });
    const released = vi.fn(async () => {});
    const loader = { dispose: failed };
    const other = { dispose: released };
    const scope = createDisposalScope();

    await expect(scope.dispose(loader, other)).rejects.toThrow("1 component(s) failed to dispose.");
    await expect(scope.dispose(loader)).rejects.toThrow("1 component(s) failed to dispose.");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("allows reusable engines to be disposed again by a later ownership scope", async () => {
    const dispose = vi.fn(async () => {});
    const engine = Object.freeze({ dispose });
    await createDisposalScope().dispose(engine);
    await createDisposalScope().dispose(engine);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("releases composed engines again after a new load", async () => {
    const { loader, rasterizer, releaseLoader, releaseRasterizer } = resources();
    const composed = withRasterizer(loader, rasterizer);
    await composed.dispose();
    await composed.dispose();
    expect(releaseLoader).toHaveBeenCalledTimes(1);
    await composed.load({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }, {
      signal: new AbortController().signal, logger: silentLogger,
    });
    await composed.dispose();
    expect(releaseLoader).toHaveBeenCalledTimes(2);
    expect(releaseRasterizer).toHaveBeenCalledTimes(2);
  });
});
