import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingComponentError, silentLogger, type Rasterizer } from "docture";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";

const engine = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => engine);

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const pdf = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
const rasterizer: Rasterizer = {
  name: "image", formats: ["png"],
  async rasterize() { return [{ pageNumber: 1, bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, scale: 1, format: "png" }]; },
};
const worker = {
  setParameters: async () => undefined,
  recognize: async () => ({ data: { text: "", confidence: 100, blocks: null } }),
  terminate: async () => undefined,
};
afterEach(() => { engine.createWorker.mockReset(); });

async function langDir(files: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docture-lang-"));
  for (const file of files) await writeFile(join(dir, file), "model");
  return dir;
}

async function workerOptions(langPath: string, languages = ["eng"]): Promise<Record<string, unknown>> {
  engine.createWorker.mockResolvedValue(worker);
  const cachePath = await mkdtemp(join(tmpdir(), "docture-cache-"));
  const loader = new DocumentLoaderTesseract({ rasterizer, langPath, cachePath, languages, concurrency: 1 });
  await loader.load(pdf, ctx);
  await loader.dispose();
  const [langs, , options] = engine.createWorker.mock.calls[0]!;
  const { errorHandler: _handler, cachePath: _cache, ...rest } = options as Record<string, unknown>;
  return { langs, ...rest };
}

describe("Tesseract langPath", () => {
  it("reads plain traineddata files from a local directory", async () => {
    const langPath = await langDir(["eng.traineddata", "deu.traineddata"]);
    expect(await workerOptions(langPath, ["eng", "deu"])).toEqual({
      langs: "eng+deu",
      langPath,
      gzip: false,
    });
  });

  it("reads gzipped traineddata files from a local directory", async () => {
    const langPath = await langDir(["eng.traineddata.gz"]);
    expect(await workerOptions(langPath)).toEqual({ langs: "eng", langPath });
  });

  it("passes a URL through without looking for files", async () => {
    expect(await workerOptions("https://models.example/tessdata")).toEqual({
      langs: "eng",
      langPath: "https://models.example/tessdata",
    });
  });

  it("fails before starting a worker when a language has no model in the directory", async () => {
    const langPath = await langDir(["eng.traineddata"]);
    const loader = new DocumentLoaderTesseract({ rasterizer, langPath, languages: ["eng", "deu"], concurrency: 1 });
    engine.createWorker.mockResolvedValue(worker);

    const error = await loader.load(pdf, ctx).catch((reason: unknown) => reason);
    await loader.dispose();

    expect(error).toBeInstanceOf(MissingComponentError);
    expect((error as Error).message).toBe(
      `Tesseract langPath "${langPath}" is missing ${join(langPath, "deu.traineddata")}. ` +
        "Every language needs a <lang>.traineddata file, or every language needs a <lang>.traineddata.gz file.",
    );
    expect(engine.createWorker.mock.calls).toEqual([]);
  });
});
