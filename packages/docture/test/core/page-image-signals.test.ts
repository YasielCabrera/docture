import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createExtractor,
  defineStrategy,
  silentLogger,
  withRasterizer,
  type LoadedPage,
  type Rasterizer,
} from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";

interface PendingRender {
  readonly signal: AbortSignal;
  readonly pageNumber: number;
  finish(): void;
  fail(error: Error): void;
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const raw = { bytes: new Uint8Array([1]), mimeType: "application/pdf" };

function pendingRasterizer() {
  const renders: PendingRender[] = [];
  const rasterizer: Rasterizer = {
    name: "pending",
    formats: ["png"],
    rasterize(_document, options, ctx) {
      const pageNumber = options.pages?.[0] ?? 1;
      return new Promise((resolve, reject) => {
        renders.push({
          signal: ctx.signal,
          pageNumber,
          finish: () => resolve([{
            pageNumber, bytes: new Uint8Array([...PNG, pageNumber]),
            widthPx: 1, heightPx: 1, scale: 1, format: "png",
          }]),
          fail: reject,
        });
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      });
    },
  };
  return { rasterizer, renders };
}

async function loadedPage(rasterizer: Rasterizer, signal = new AbortController().signal) {
  const loader = withRasterizer(inMemoryLoader(loadedDocument(["one"])), rasterizer);
  const loaded = await loader.load(raw, { signal, logger: silentLogger });
  const page = loaded.pages[0]!;
  return page as LoadedPage & { image: NonNullable<LoadedPage["image"]> };
}

describe("page images and per-call signals", { timeout: 2_000 }, () => {
  it("cancels the render for an aborted call, then renders again for a later live call", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const page = await loadedPage(rasterizer);
    const caller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");

    const aborted = page.image({ dpi: 72 }, { signal: caller.signal });
    caller.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    expect(renders.map((render) => render.signal.aborted)).toEqual([true]);

    const retry = page.image({ dpi: 72 }, { signal: new AbortController().signal });
    renders[1]!.finish();
    expect([...(await retry)]).toEqual([...PNG, 1]);
    expect([...(await page.image({ dpi: 72 }))]).toEqual([...PNG, 1]);
    expect(renders).toHaveLength(2);
  });

  it("rejects and does not memoize a call aborted while the rasterizer starts", async () => {
    const caller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    let calls = 0;
    const rasterizer: Rasterizer = {
      name: "aborts-on-start",
      formats: ["png"],
      async rasterize(_document, _options, ctx) {
        calls += 1;
        if (calls === 1) caller.abort(reason);
        ctx.signal.throwIfAborted();
        return [{ pageNumber: 1, bytes: new Uint8Array([...PNG, calls]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }];
      },
    };
    const page = await loadedPage(rasterizer);

    await expect(page.image({ dpi: 72 }, { signal: caller.signal })).rejects.toBe(reason);
    expect([...(await page.image({ dpi: 72 }))]).toEqual([...PNG, 2]);
  });

  it("keeps a shared render running for a live caller when another caller aborts", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const page = await loadedPage(rasterizer);
    const leaving = new AbortController();
    const staying = new AbortController();

    const first = page.image({ dpi: 72 }, { signal: leaving.signal });
    const second = page.image({ dpi: 72 }, { signal: staying.signal });
    leaving.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(renders.map((render) => render.signal.aborted)).toEqual([false]);

    renders[0]!.finish();
    expect([...(await second)]).toEqual([...PNG, 1]);
    expect(renders).toHaveLength(1);
  });

  it("answers a live call from cached bytes and still rejects an already aborted call", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const page = await loadedPage(rasterizer);
    const first = page.image({ dpi: 72 });
    renders[0]!.finish();
    await first;

    expect([...(await page.image({ dpi: 72 }, { signal: new AbortController().signal }))]).toEqual([...PNG, 1]);
    await expect(page.image({ dpi: 72 }, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(renders).toHaveLength(1);
  });

  it("follows the load signal when a call passes none", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const load = new AbortController();
    const page = await loadedPage(rasterizer, load.signal);

    const image = page.image({ dpi: 72 });
    load.abort();
    await expect(image).rejects.toMatchObject({ name: "AbortError" });
    expect(renders[0]!.signal.aborted).toBe(true);
  });

  it("evicts a failed render so the next call renders again", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const page = await loadedPage(rasterizer);

    const failed = page.image({ dpi: 72 }, { signal: new AbortController().signal });
    renders[0]!.fail(new Error("render failed"));
    await expect(failed).rejects.toThrow("render failed");

    const retry = page.image({ dpi: 72 });
    renders[1]!.finish();
    expect([...(await retry)]).toEqual([...PNG, 1]);
  });

  it("cancels a strategy's render when the caller aborts after the load stage returned", async () => {
    const { rasterizer, renders } = pendingRasterizer();
    const caller = new AbortController();
    const strategy = defineStrategy({
      name: "looks-at-page-one",
      requires: ["RENDERABLE_PAGES"],
      async extract(ctx) {
        await ctx.document.pages[0]!.image!({ dpi: 72 }, { signal: ctx.signal });
        return { data: { value: "seen" } };
      },
    });
    const extractor = createExtractor({
      loaders: [withRasterizer(inMemoryLoader(loadedDocument(["one"])), rasterizer)],
      strategies: [strategy],
    });

    const run = extractor.extract(raw.bytes, z.object({ value: z.string() }), { signal: caller.signal });
    const settled = run.catch((error: unknown) => error);
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    caller.abort();

    await vi.waitFor(() => expect(renders[0]!.signal.aborted).toBe(true), { timeout: 500 });
    expect(await settled).toMatchObject({ name: "AbortError" });
  });
});
