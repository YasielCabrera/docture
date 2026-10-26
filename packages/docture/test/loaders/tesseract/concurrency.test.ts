import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger, type Rasterizer } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";

const state = vi.hoisted(() => ({ cpus: 8, concurrency: 0, active: 0, peak: 0, block: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:os", async (importOriginal) => ({ ...await importOriginal<typeof import("node:os")>(), availableParallelism: () => state.cpus }));
vi.mock("../../../src/loaders/tesseract/tesseract.js", () => ({
  TesseractPool: class {
    constructor(options: { concurrency: number }) { state.concurrency = options.concurrency; }
    async recognize() {
      state.active++; state.peak = Math.max(state.peak, state.active);
      await state.block?.(); state.active--;
      return { words: [], confidence: 1 };
    }
    async terminate() {}
  },
}));
const rasterizer: Rasterizer = {
  name: "pages", formats: ["png"],
  async rasterize() { return [1, 2, 3, 4, 5, 6].map((pageNumber) => ({ pageNumber, bytes: new Uint8Array([pageNumber]), widthPx: 1, heightPx: 1, scale: 1, format: "png" })); },
};
const ctx = { signal: new AbortController().signal, logger: silentLogger };
const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
afterEach(() => { state.block = undefined; state.active = 0; state.peak = 0; });

describe("Tesseract default concurrency", () => {
  it.each([[1, 1], [2, 1], [8, 4]])("uses %i CPUs to choose %i workers", async (cpus, expected) => {
    state.cpus = cpus;
    const loader = new DocumentLoaderTesseract({ rasterizer });
    expect((await loader.load(raw, ctx)).pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.concurrency).toBe(expected);
    await loader.dispose();
  });

  it("keeps an explicit single worker on a larger CPU", async () => {
    state.cpus = 8;
    const loader = new DocumentLoaderTesseract({ rasterizer, concurrency: 1 });
    await loader.load(raw, ctx);
    expect(state.concurrency).toBe(1);
    await loader.dispose();
  });

  it("bounds simultaneous recognition to four pages", async () => {
    state.cpus = 8;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    state.block = () => { entered.resolve(); return release.promise; };
    const loader = new DocumentLoaderTesseract({ rasterizer });
    const task = loader.load(raw, ctx);
    await entered.promise;
    try { expect(state.peak).toBe(4); }
    finally { release.resolve(); await task; await loader.dispose(); }
    expect(state.peak).toBe(4);
  });
});
