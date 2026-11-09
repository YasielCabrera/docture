import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger, type LoadedPage } from "docture";

const engine = vi.hoisted(() => ({ createWorker: vi.fn(), real: process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true" }));
vi.mock("tesseract.js", async (importOriginal) => (engine.real ? importOriginal() : { createWorker: engine.createWorker }));

const { DocumentLoaderTesseract } = await import("docture/loaders/tesseract");

const ctx = { signal: new AbortController().signal, logger: silentLogger };

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function turningEngine(rotateRadians: number): void {
  engine.createWorker.mockImplementation(async () => ({
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => ({
      data: {
        text: "word",
        confidence: 90,
        rotateRadians,
        blocks: [{ paragraphs: [{ lines: [{ words: [
          { text: "word", confidence: 90, bbox: { x0: 100, y0: 100, x1: 200, y1: 150 } },
        ] }] }] }],
      },
    })),
    terminate: vi.fn(async () => undefined),
  }));
}

const firstSpan = (page: LoadedPage) => {
  const span = page.lines![0]!.spans[0]!;
  return [span.x, span.y, span.width, span.height].map((value) => Math.round(value));
};

afterEach(() => { engine.createWorker.mockReset(); });

describe.skipIf(engine.real)("Tesseract autoRotate boxes", () => {
  it("turns boxes from the deskewed frame back onto the page image", async () => {
    turningEngine(Math.PI / 2);
    await using loader = new DocumentLoaderTesseract({ dpi: 72, autoRotate: true });
    const page = (await loader.load({ bytes: pngHeader(1000, 1000), mimeType: "image/png" }, ctx)).pages[0]!;
    expect(firstSpan(page)).toEqual([100, 800, 50, 100]);
  });

  it("leaves boxes alone when the engine turned nothing", async () => {
    turningEngine(0);
    await using loader = new DocumentLoaderTesseract({ dpi: 72, autoRotate: true });
    const page = (await loader.load({ bytes: pngHeader(1000, 1000), mimeType: "image/png" }, ctx)).pages[0]!;
    expect(firstSpan(page)).toEqual([100, 100, 100, 50]);
  });
});

describe.skipIf(!engine.real)("Tesseract autoRotate boxes, real OCR", () => {
  it("puts deskewed words where they sit on the skewed page", async () => {
    const canvas = createCanvas(1200, 800);
    const draw = canvas.getContext("2d");
    draw.fillStyle = "white";
    draw.fillRect(0, 0, 1200, 800);
    draw.translate(600, 400);
    draw.rotate((4 * Math.PI) / 180);
    draw.translate(-600, -400);
    draw.fillStyle = "black";
    draw.font = "40px sans-serif";
    for (let row = 0; row < 8; row += 1) draw.fillText(`Line ${row + 1} quick brown fox jumps over`, 80, 120 + row * 80);
    const bytes = canvas.encodeSync("jpeg", 95);

    const boxes = async (autoRotate: boolean) => {
      await using loader = new DocumentLoaderTesseract({ dpi: 150, autoRotate });
      const page = (await loader.load({ bytes, mimeType: "image/jpeg" }, ctx)).pages[0]!;
      return page.lines!.flatMap((line) => line.spans).map((span) => [span.text, span.x, span.y] as const);
    };
    const straight = await boxes(false);
    const turned = await boxes(true);
    const offsets = turned.map(([text, x, y]) => Math.min(
      ...straight.filter((candidate) => candidate[0] === text).map((candidate) => Math.max(Math.abs(candidate[1] - x), Math.abs(candidate[2] - y))),
    ));
    expect(turned.length).toBeGreaterThan(40);
    expect(Math.max(...offsets)).toBeLessThan(4);
  }, 120_000);
});
