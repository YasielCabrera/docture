import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";
import { jpegOrientation } from "../../../src/core/domain/image.js";

const engine = vi.hoisted(() => ({ createWorker: vi.fn(), real: process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true" }));
vi.mock("tesseract.js", async (importOriginal) => (engine.real ? importOriginal() : { createWorker: engine.createWorker }));

const { DocumentLoaderTesseract } = await import("docture/loaders/tesseract");

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function exifSegment(orientation: number, littleEndian: boolean): number[] {
  const tiff = littleEndian
    ? [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return [0xff, 0xe1, 0, payload.length + 2, ...payload];
}

/** A JPEG header whose stored frame is 150 x 600, after a JFIF block and an EXIF block. */
function jpegHeader(orientation: number, littleEndian: boolean): Uint8Array {
  const jfif = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0, 11, 8, 600 >> 8, 600 & 0xff, 0, 150, 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...jfif, ...exifSegment(orientation, littleEndian), ...sof, 0xff, 0xd9]);
}

/** The test tesseract.js 7 runs on the first 500 bytes to choose the orientation it applies. */
function orientationTesseractApplies(image: Uint8Array): number {
  return Number(/1 18 0 3 0 0 0 1 0 (\d)/u.exec([...image.subarray(0, 500)].join(" "))?.[1] ?? 1);
}

function recordingEngine(): number[] {
  const applied: number[] = [];
  engine.createWorker.mockImplementation(async () => ({
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async (image: Uint8Array, _options: unknown, output: Record<string, boolean>) => {
      applied.push(orientationTesseractApplies(image));
      const png = Buffer.from([...PNG, output["imageColor"] === true ? 1 : 0]).toString("base64");
      return {
        data: {
          text: "HELLO",
          confidence: 90,
          ...(output["imageColor"] === true ? { imageColor: `data:image/png;base64,${png}` } : {}),
          blocks: [{ paragraphs: [{ lines: [{ words: [
            { text: "HELLO", confidence: 90, bbox: { x0: 35, y0: 53, x1: 214, y1: 99 } },
          ] }] }] }],
        },
      };
    }),
    terminate: vi.fn(async () => undefined),
  }));
  return applied;
}

afterEach(() => { engine.createWorker.mockReset(); });

describe.skipIf(engine.real)("Tesseract JPEG EXIF orientation", () => {
  it("reads the orientation from little- and big-endian EXIF", () => {
    expect([1, 3, 6, 8].flatMap((value) => [jpegOrientation(jpegHeader(value, true)), jpegOrientation(jpegHeader(value, false))]))
      .toEqual([1, 1, 3, 3, 6, 6, 8, 8]);
    expect(jpegOrientation(new Uint8Array([...PNG, 0, 0, 0, 0]))).toBe(1);
  });

  it.each([[true], [false]])("reports a quarter-turned JPEG upright and has the engine read it upright (little-endian %s)", async (littleEndian) => {
    const applied = recordingEngine();
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    const document = await loader.load({ bytes: jpegHeader(6, littleEndian), mimeType: "image/jpeg" }, ctx);
    const page = document.pages[0]!;

    expect(applied).toEqual([6]);
    expect({ width: page.width, height: page.height }).toEqual({ width: 600, height: 150 });
    expect([...await page.image!()]).toEqual([...PNG, 1]);
  });

  it("leaves an upright JPEG and its bytes alone", async () => {
    const applied = recordingEngine();
    const bytes = jpegHeader(1, false);
    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    const page = (await loader.load({ bytes, mimeType: "image/jpeg" }, ctx)).pages[0]!;
    expect(applied).toEqual([1]);
    expect({ width: page.width, height: page.height }).toEqual({ width: 150, height: 600 });
    expect(await page.image!()).toBe(bytes);
  });
});

describe.skipIf(!engine.real)("Tesseract JPEG EXIF orientation, real OCR", () => {
  it.each([[true], [false]])("reads a sideways-stored JPEG upright inside its upright page (little-endian %s)", async (littleEndian) => {
    const upright = createCanvas(600, 150);
    const draw = upright.getContext("2d");
    draw.fillStyle = "white";
    draw.fillRect(0, 0, 600, 150);
    draw.fillStyle = "black";
    draw.font = "bold 64px sans-serif";
    draw.fillText("HELLO", 30, 100);
    const stored = createCanvas(150, 600);
    const turn = stored.getContext("2d");
    turn.translate(0, 600);
    turn.rotate(-Math.PI / 2);
    turn.drawImage(upright, 0, 0);
    const jpeg = stored.encodeSync("jpeg", 95);
    const bytes = new Uint8Array([...jpeg.subarray(0, 2), ...exifSegment(6, littleEndian), ...jpeg.subarray(2)]);

    await using loader = new DocumentLoaderTesseract({ dpi: 72 });
    const page = (await loader.load({ bytes, mimeType: "image/jpeg" }, ctx)).pages[0]!;
    const span = page.lines![0]!.spans[0]!;
    expect({ text: page.text.trim(), width: page.width, height: page.height }).toEqual({ text: "HELLO", width: 600, height: 150 });
    expect(span.x + span.width).toBeLessThanOrEqual(page.width);
  }, 60_000);
});
