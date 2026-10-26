import { beforeEach, describe, expect, it, vi } from "vitest";
import { silentLogger, type Logger } from "docture";
import { DocumentLoaderMuPdf, MuPdfRasterizer } from "docture/loaders/mupdf";

const state = vi.hoisted(() => ({
  reads: [] as number[],
  destroyed: 0,
  warning: undefined as ((message: string) => void) | undefined,
  yield: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:timers/promises", () => ({ setImmediate: () => state.yield?.() ?? Promise.resolve() }));
vi.mock("mupdf", () => ({
  setLog(log: { warning: (message: string) => void }) { state.warning = log.warning; },
  Matrix: { scale: (x: number, y: number) => [x, y] },
  ColorSpace: { DeviceRGB: {} },
  Document: {
    openDocument(bytes: Uint8Array) {
      const source = bytes[0];
      return {
        needsPassword() { return false; },
        countPages() { return 3; },
        loadPage(index: number) {
          state.reads.push(index + 1);
          state.warning?.("source-" + source + "-page-" + (index + 1));
          return {
            getBounds() { return [0, 0, 10, 10]; },
            toStructuredText() { return { walk() {}, destroy() {} }; },
            toPixmap() { return { getWidth() { return 10; }, getHeight() { return 10; }, asPNG() { return new Uint8Array([index + 1]); }, destroy() {} }; },
            destroy() {},
          };
        },
        destroy() { state.destroyed++; },
      };
    },
  },
}));
beforeEach(() => { state.reads.length = 0; state.destroyed = 0; state.yield = undefined; });

function run(mode: string, signal: AbortSignal, logger: Logger = silentLogger, source = 1) {
  const raw = { bytes: new Uint8Array([source]), mimeType: "application/pdf" };
  if (mode === "load") return new DocumentLoaderMuPdf().load(raw, { signal, logger }).then((document) => document.pages);
  return new MuPdfRasterizer().rasterize(raw, {}, { signal, logger });
}

describe.each(["load", "rasterize"])("MuPDF %s scheduling", (mode) => {
  it("yields between pages and releases the document", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    state.yield = () => { entered.resolve(); return release.promise; };
    const task = run(mode, new AbortController().signal);
    await Promise.race([entered.promise, task]);
    try { expect(state.reads).toEqual([1]); }
    finally { release.resolve(); await task; }
    expect(state.reads).toEqual([1, 2, 3]);
    expect(state.destroyed).toBe(1);
  });

  it("delivers abort between pages and destroys the document", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const caller = new AbortController();
    state.yield = () => { entered.resolve(); return release.promise; };
    const task = run(mode, caller.signal).then(() => "completed", (error: Error) => error.name);
    await Promise.race([entered.promise, task]);
    caller.abort();
    release.resolve();
    expect(await task).toBe("AbortError");
    expect(state.reads).toEqual([1]);
    expect(state.destroyed).toBe(1);
  });

  it("keeps concurrent document diagnostics on their own logger", async () => {
    const first: string[] = [];
    const second: string[] = [];
    const logger = (messages: string[]): Logger => ({
      ...silentLogger,
      warn(_message, fields) { messages.push(String(fields?.detail)); },
    });
    await Promise.all([
      run(mode, new AbortController().signal, logger(first), 1),
      run(mode, new AbortController().signal, logger(second), 2),
    ]);
    expect(first).toEqual(["source-1-page-1", "source-1-page-2", "source-1-page-3"]);
    expect(second).toEqual(["source-2-page-1", "source-2-page-2", "source-2-page-3"]);
  });
});
