import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";

const engine = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: engine.createWorker }));

const { DocumentLoaderTesseract } = await import("docture/loaders/tesseract");

const ctx = { signal: new AbortController().signal, logger: silentLogger };

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** An engine that reads each page segmentation mode as `readings` says, and counts its readings. */
function engineReading(readings: Record<string, { text: string; confidence: number }>): { calls: string[] } {
  const state = { calls: [] as string[] };
  engine.createWorker.mockImplementation(async () => {
    let mode = "3";
    return {
      setParameters: vi.fn(async (params: Record<string, string>) => { mode = params["tessedit_pageseg_mode"] ?? mode; }),
      recognize: vi.fn(async () => {
        state.calls.push(mode);
        const reading = readings[mode] ?? { text: "", confidence: 0 };
        return { data: { text: reading.text, confidence: reading.confidence, blocks: [{ paragraphs: [{ lines: [{ words: [
          { text: reading.text, confidence: reading.confidence, bbox: { x0: 100, y0: 100, x1: 400, y1: 140 } },
        ] }] }] }] } };
      }),
      terminate: vi.fn(async () => undefined),
    };
  });
  return state;
}

const textOf = async (loader: InstanceType<typeof DocumentLoaderTesseract>) =>
  (await loader.load({ bytes: pngHeader(1000, 1000), mimeType: "image/png" }, ctx)).text.trim();

afterEach(() => { engine.createWorker.mockReset(); });

describe("Tesseract auto page segmentation", () => {
  it("reads a low-confidence page again as one block and keeps the more confident reading", async () => {
    const state = engineReading({ "3": { text: "garbled", confidence: 50 }, "6": { text: "table", confidence: 90 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("table");
    expect(state.calls).toEqual(["3", "6"]);
  });

  it("keeps the layout reading when the block reading is no more confident", async () => {
    engineReading({ "3": { text: "columns", confidence: 70 }, "6": { text: "merged", confidence: 60 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("columns");
  });

  it("reads a page of plenty of confident text once", async () => {
    const page = "clean ".repeat(250).trim();
    const state = engineReading({ "3": { text: page, confidence: 92 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe(page);
    expect(state.calls).toEqual(["3"]);
  });

  it("reads a confident page with little text again and keeps a block reading that finds far more", async () => {
    const state = engineReading({ "3": { text: "one column", confidence: 90 }, "6": { text: "one column and two more columns", confidence: 88 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("one column and two more columns");
    expect(state.calls).toEqual(["3", "6"]);
  });

  it("keeps the layout reading when the block reading finds more text only by reading speckle", async () => {
    engineReading({ "3": { text: "a few clear words", confidence: 70 }, "6": { text: "a few clear words and lots of noise", confidence: 20 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("a few clear words");
  });

  it("reads a page with no words once", async () => {
    const state = engineReading({ "3": { text: "", confidence: 0 }, "6": { text: "speckle", confidence: 60 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("");
    expect(state.calls).toEqual(["3"]);
  });

  it("keeps a garbled layout reading over a block reading of noise", async () => {
    engineReading({ "3": { text: "garbled", confidence: 30 }, "6": { text: "noise read as many words", confidence: 40 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("garbled");
  });

  it("keeps a low-confidence layout reading when the block reading loses its confident text", async () => {
    const words = [
      { text: "a long confidently read paragraph", confidence: 85 },
      { text: "smudge", confidence: 10 },
    ];
    engine.createWorker.mockImplementation(async () => {
      let mode = "3";
      return {
        setParameters: vi.fn(async (params: Record<string, string>) => { mode = params["tessedit_pageseg_mode"] ?? mode; }),
        recognize: vi.fn(async () => {
          const read = mode === "3" ? words : [{ text: "short", confidence: 95 }];
          return { data: { text: read.map((word) => word.text).join(" "), confidence: 0, blocks: [{ paragraphs: [{ lines: [{ words: read.map((word, index) => (
            { ...word, bbox: { x0: 100 + index * 400, y0: 100, x1: 450 + index * 400, y1: 140 } }
          )) }] }] }] } };
        }),
        terminate: vi.fn(async () => undefined),
      };
    });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toContain("confidently");
  });

  it("keeps the layout reading when the block reading fails", async () => {
    engine.createWorker.mockImplementation(async () => {
      let mode = "3";
      return {
        setParameters: vi.fn(async (params: Record<string, string>) => { mode = params["tessedit_pageseg_mode"] ?? mode; }),
        recognize: vi.fn(async () => {
          if (mode === "6") throw "block mode failed";
          return { data: { text: "layout", confidence: 50, blocks: [{ paragraphs: [{ lines: [{ words: [
            { text: "layout", confidence: 50, bbox: { x0: 100, y0: 100, x1: 400, y1: 140 } },
          ] }] }] }] } };
        }),
        terminate: vi.fn(async () => undefined),
      };
    });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    expect(await textOf(loader)).toBe("layout");
  });

  it("replaces a worker whose layout mode cannot be restored", async () => {
    const modes: string[] = [];
    engine.createWorker.mockImplementation(async () => {
      let mode = "3";
      return {
        setParameters: vi.fn(async (params: Record<string, string>) => {
          if (mode === "6") throw "stuck";
          mode = params["tessedit_pageseg_mode"] ?? mode;
        }),
        recognize: vi.fn(async () => {
          modes.push(mode);
          return { data: { text: "page", confidence: 50, blocks: [{ paragraphs: [{ lines: [{ words: [
            { text: "page", confidence: 50, bbox: { x0: 100, y0: 100, x1: 400, y1: 140 } },
          ] }] }] }] } };
        }),
        terminate: vi.fn(async () => undefined),
      };
    });
    await using loader = new DocumentLoaderTesseract({ dpi: 72, concurrency: 1 });
    await textOf(loader);
    await textOf(loader);
    expect(modes).toEqual(["3", "6", "3", "6"]);
    expect(engine.createWorker).toHaveBeenCalledTimes(2);
  });

  it("does not read a page again once the load is aborted", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    engine.createWorker.mockImplementation(async () => {
      let mode = "3";
      return {
        setParameters: vi.fn(async (params: Record<string, string>) => { mode = params["tessedit_pageseg_mode"] ?? mode; }),
        recognize: vi.fn(async () => {
          calls.push(mode);
          controller.abort();
          return { data: { text: "garbled", confidence: 40, blocks: [{ paragraphs: [{ lines: [{ words: [
            { text: "garbled", confidence: 40, bbox: { x0: 100, y0: 100, x1: 400, y1: 140 } },
          ] }] }] }] } };
        }),
        terminate: vi.fn(async () => undefined),
      };
    });
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    await expect(loader.load({ bytes: pngHeader(1000, 1000), mimeType: "image/png" }, { ...ctx, signal: controller.signal })).rejects.toThrow();
    expect(calls).toEqual(["3"]);
  });

  it("never retries a mode the caller chose", async () => {
    const state = engineReading({ "11": { text: "sparse", confidence: 40 } });
    await using loader = new DocumentLoaderTesseract({ dpi: 72, pageSegmentation: "sparse" });
    expect(await textOf(loader)).toBe("sparse");
    expect(state.calls).toEqual(["11"]);
  });
});
