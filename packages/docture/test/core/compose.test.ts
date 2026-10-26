import { describe, expect, it } from "vitest";
import { silentLogger, withRasterizer, type RasterOptions, type Rasterizer } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const raw = { bytes: new Uint8Array([1]), mimeType: "application/pdf" };

describe("composed image defaults", () => {
  it("leaves constructor defaults available and applies explicit overrides", async () => {
    const calls: RasterOptions[] = [];
    const rasterizer: Rasterizer = {
      name: "recording", formats: ["png", "jpeg"],
      async rasterize(_raw, options) {
        calls.push(options ?? {});
        return [{ pageNumber: 1, bytes: new Uint8Array([4]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
      },
    };
    const loaded = await withRasterizer(inMemoryLoader(loadedDocument(["x"])), rasterizer).load(raw, ctx);
    await loaded.pages[0]?.image?.();
    await loaded.pages[0]?.image?.({ dpi: 150 });
    const composed = await withRasterizer(inMemoryLoader(loadedDocument(["x"])), rasterizer, { defaults: { dpi: 100 } }).load(raw, ctx);
    await composed.pages[0]?.image?.();
    await composed.pages[0]?.image?.({ dpi: 150 });
    expect(calls).toEqual([{ pages: [1] }, { dpi: 150, pages: [1] }, { dpi: 100, pages: [1] }, { dpi: 150, pages: [1] }]);
  });
});

describe("composed image retries", () => {
  it("retries rejected renders and shares successful pending work", async () => {
    let calls = 0;
    const finished = Promise.withResolvers<readonly import("docture").RasterPage[]>();
    const rasterizer: Rasterizer = {
      name: "flaky", formats: ["png"],
      async rasterize() {
        calls++;
        if (calls === 1) throw Error("transient render failure");
        return finished.promise;
      },
    };
    const loaded = await withRasterizer(inMemoryLoader(loadedDocument(["x"])), rasterizer).load(raw, ctx);
    const image = loaded.pages[0]?.image;
    await expect(image?.()).rejects.toThrow("transient render failure");
    const second = image?.();
    const concurrent = image?.();
    finished.resolve([{ pageNumber: 1, bytes: new Uint8Array([7]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }]);
    const retried = await second?.catch(() => undefined);
    await concurrent?.catch(() => undefined);
    expect(retried).toEqual(new Uint8Array([7]));
    expect(calls).toBe(2);
    expect(await image?.()).toEqual(new Uint8Array([7]));
    expect(calls).toBe(2);
  });
});
