import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger, type Rasterizer } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";

const engine = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => engine);

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const raw = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
const rasterizer: Rasterizer = {
  name: "image", formats: ["png"],
  async rasterize() { return [{ pageNumber: 1, bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }]; },
};
const worker = () => ({
  setParameters: vi.fn(async () => undefined),
  recognize: vi.fn(async () => ({ data: { text: "", confidence: 100, blocks: null } })),
  terminate: vi.fn(async () => undefined),
});
afterEach(() => { engine.createWorker.mockReset(); });

describe("Tesseract worker lifecycle", () => {
  it("reports failed termination when worker creation finishes during disposal", async () => {
    const spawned = worker();
    const failure = new Error("cleanup failed");
    spawned.terminate.mockRejectedValueOnce(failure);
    const entered = Promise.withResolvers<void>();
    const creation = Promise.withResolvers<typeof spawned>();
    engine.createWorker.mockImplementation(() => { entered.resolve(); return creation.promise; });
    const loader = new DocumentLoaderTesseract({ rasterizer });
    const loading = loader.load(raw, ctx).catch((error: unknown) => error);
    await entered.promise;
    const disposing = loader.dispose().catch((error: unknown) => error);
    creation.resolve(spawned);
    expect(await loading).toBe(failure);
    expect(await disposing).toMatchObject({ errors: [failure] });
    expect(spawned.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects queued loads after the last worker startup fails and permits a retry", async () => {
    const entered = Promise.withResolvers<void>();
    const creation = Promise.withResolvers<ReturnType<typeof worker>>();
    engine.createWorker.mockImplementationOnce(() => { entered.resolve(); return creation.promise; });
    const loader = new DocumentLoaderTesseract({ rasterizer, concurrency: 1 });
    const first = loader.load(raw, ctx).catch((error: unknown) => error);
    await entered.promise;
    let second: unknown = "pending";
    const queued = loader.load(raw, ctx).then(() => { second = "loaded"; }, (error: unknown) => { second = error; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const failure = new Error("startup failed");
    creation.reject(failure);
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(second).toBe(failure);
      const spawned = worker();
      engine.createWorker.mockResolvedValueOnce(spawned);
      await expect(loader.load(raw, ctx)).resolves.toMatchObject({ loader: "tesseract" });
    } finally {
      await loader.dispose();
      await queued;
    }
  });

  it("terminates workers whose creation finishes during disposal", async () => {
    const spawned = worker();
    const entered = Promise.withResolvers<void>();
    const creation = Promise.withResolvers<typeof spawned>();
    engine.createWorker.mockImplementation(() => { entered.resolve(); return creation.promise; });
    const loader = new DocumentLoaderTesseract({ rasterizer });
    const loading = loader.load(raw, ctx).then(() => "loaded", (error: Error) => error.message);
    await entered.promise;
    const disposing = loader.dispose();
    creation.resolve(spawned);
    const outcome = await loading;
    await disposing;
    expect(spawned.recognize).toHaveBeenCalledTimes(0);
    expect(spawned.terminate).toHaveBeenCalledTimes(1);
    expect(outcome).toContain("disposed");
    await loader.dispose();
    expect(spawned.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates a worker when parameter setup fails", async () => {
    const spawned = worker();
    spawned.setParameters.mockRejectedValueOnce(Error("setup failed"));
    engine.createWorker.mockResolvedValueOnce(spawned);
    const loader = new DocumentLoaderTesseract({ rasterizer });
    await expect(loader.load(raw, ctx)).rejects.toThrow("setup failed");
    expect(spawned.recognize).toHaveBeenCalledTimes(0);
    expect(spawned.terminate).toHaveBeenCalledTimes(1);
    await loader.dispose();
    expect(spawned.terminate).toHaveBeenCalledTimes(1);
  });
});
