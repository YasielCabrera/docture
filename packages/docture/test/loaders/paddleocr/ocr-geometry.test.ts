import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentConverter, silentLogger, type LoadedDocument } from "docture";
import { regionTextSize, tiltFromHeights, tiltGrowth } from "../../../src/loaders/paddleocr/region-geometry.js";

type Region = [text: string, x: number, y: number, width: number, height: number, confidence: number];
interface Page { readonly widthPx: number; readonly heightPx: number; readonly regions: Region[] }

const engine = vi.hoisted(() => ({ page: undefined as Page | undefined }));
vi.mock("ppu-paddle-ocr", () => ({
  PaddleOcrService: class {
    async initialize() {}
    async batchRecognize(images: readonly ArrayBuffer[]) {
      return images.map(() => ({
        text: "",
        confidence: 0.99,
        results: engine.page!.regions.map(([text, x, y, width, height, confidence]) => ({ text, confidence, box: { x, y, width, height } })),
      }));
    }
    async destroy() {}
  },
}));

const { DocumentLoaderPaddleOcr } = await import("docture/loaders/paddleocr");

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const fixture = (name: string): Page =>
  JSON.parse(readFileSync(new URL(`../fixtures/ocr-geometry/${name}.paddle.json`, import.meta.url), "utf8")) as Page;
const invoice = JSON.parse(readFileSync(new URL("../fixtures/ocr-geometry/invoice.truth.json", import.meta.url), "utf8")) as { table?: string[][] }[];

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** Load a page as if PaddleOCR had recognized it, at 300 DPI. */
async function load(page: Page): Promise<LoadedDocument> {
  engine.page = page;
  await using loader = new DocumentLoaderPaddleOcr({ dpi: 300 });
  return loader.load({ bytes: pngHeader(page.widthPx, page.heightPx), mimeType: "image/png" }, ctx);
}

const markdown = async (loaded: LoadedDocument) => (await new DocumentConverter().convert({ loaded })).content;
const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("#"));
const padding = { vertical: 0.4, horizontal: 0.6 };

afterEach(() => { engine.page = undefined; });

describe("PaddleOCR text sizes", () => {
  it("reads a short quantity near the size of the prose beside it, which its box height does not", () => {
    // One 10pt invoice: a quantity and a long line, as PaddleOCR v6 Small boxed them.
    const quantity = { text: "12", box: [1592, 895, 1695, 972] as const };
    const prose = { text: "Bill to: Trellis Logistics AG, Bahnhofstrasse 21, 8001 Zurich", box: [241, 572, 1346, 625] as const };
    expect((quantity.box[3] - quantity.box[1]) / (prose.box[3] - prose.box[1])).toBeGreaterThan(1.4);
    expect(regionTextSize(quantity, 0, padding)! / regionTextSize(prose, 0, padding)!).toBeLessThan(1.15);
  });

  it("leaves a lone character unsized rather than guess from its blob", () => {
    expect(regionTextSize({ text: "4", box: [1609, 813, 1700, 892] }, 0, padding)).toBeUndefined();
  });

  it("takes the height a tilted page adds to a long line back out", () => {
    const slope = Math.tan((0.8 * Math.PI) / 180);
    const straight = regionTextSize({ text: "x".repeat(50), box: [0, 0, 900, 60] }, 0, padding);
    // The kernel's rectangle grows by its width times the slope, and the padding scales it.
    const tilted = { text: "x".repeat(50), box: [0, 0, 900, 60 + 1.8 * 860 * slope] as const };
    expect(regionTextSize(tilted, slope, padding)! / straight!).toBeCloseTo(1, 1);
    expect(regionTextSize(tilted, 0, padding)! / straight!).toBeGreaterThan(1.1);
  });

  it("finds every heading of a two-column page and promotes no body line", async () => {
    for (const name of ["two-column.flatscan", "two-column.scan"]) {
      const found = headings(await markdown(await load(fixture(name))));
      expect(found.map((line) => line.replace(/^#+ /u, "")), name).toEqual(["Annual Review", "Operations", "People", "Outlook"]);
      expect(found[0], name).toBe("# Annual Review");
      expect(found.slice(1).every((line) => /^#{2,3} /u.test(line)), name).toBe(true);
    }
  });
});

/**
 * A single column of prose turned `degrees`, boxed as ppu-paddle-ocr pads a kernel: 30 px
 * tall text, 54 px tall padded, plus the kernel's width times the slope. A title set
 * 1.5 times larger comes first when `title` is set.
 */
function singleColumn(degrees: number, widths: readonly number[], title = false): Page {
  const slope = Math.abs(Math.tan((degrees * Math.PI) / 180));
  const region = (text: string, y: number, kernelWidth: number, kernelHeight: number): Region => {
    const rect = kernelHeight + kernelWidth * slope;
    return [text, 200, y, Math.round(kernelWidth + 1.2 * rect), Math.round(1.8 * rect), 0.99];
  };
  // Lowercase x is half an em wide, and a 30 px kernel is about a 54 px em.
  const prose = (kernelWidth: number) => "x".repeat(Math.round(kernelWidth / 25.6));
  return {
    widthPx: 2550,
    heightPx: 3300,
    regions: [
      ...(title ? [region("Quarterly results", 200, 640, 45)] : []),
      ...widths.map((width, line) => region(prose(width), 400 + line * 150, width, 30)),
    ],
  };
}

describe("PaddleOCR text sizes on a tilted single-column page", () => {
  it("promotes no body line when nothing on the page shows the tilt", async () => {
    // One region per line and all but one of a width: no two regions side by side and no height trend.
    const widths = [900, ...Array.from({ length: 11 }, () => 500)];
    for (const degrees of [0, 1, 3, 5]) {
      expect(headings(await markdown(await load(singleColumn(degrees, widths)))), `${degrees} degrees`).toEqual([]);
    }
  });

  it("sizes the lines from the tilt their box heights show, finding the title and no body line", async () => {
    const widths = Array.from({ length: 24 }, (_, line) => 600 + ((line * 211) % 1500));
    for (const degrees of [0, 0.8, 2]) {
      expect(headings(await markdown(await load(singleColumn(degrees, widths, true)))), `${degrees} degrees`).toEqual(["# Quarterly results"]);
    }
  });
});

describe("PaddleOCR on a tilted page", () => {
  it("measures how far a page is tilted from how its long boxes grow", () => {
    // Prose lines of one size and assorted widths, with a few pixels of detector noise.
    const page = (degrees: number) => Array.from({ length: 24 }, (_, line) => {
      const width = 600 + ((line * 211) % 1500);
      const height = 1.8 * (30 + (width - 36) * Math.abs(Math.tan((degrees * Math.PI) / 180))) + ((line * 7) % 5) - 2;
      return [200, 400 + line * 70, 200 + width, 400 + line * 70 + height] as const;
    });
    expect(tiltFromHeights(page(0), padding)).toBeLessThan(0.1);
    expect(tiltFromHeights(page(0.8), padding)).toBeCloseTo(0.8, 1);
    expect(tiltFromHeights(page(-0.8), padding)).toBeCloseTo(0.8, 1);
    expect(tiltFromHeights(page(0.8).slice(0, 3), padding)).toBeUndefined();
  });

  it("measures how much the tilt has grown the boxes, so the line band stays inside the row pitch", () => {
    // 900-wide kernels of 30 px text, padded as ppu-paddle-ocr pads them.
    const boxes = (degrees: number) => Array.from({ length: 12 }, (_, line) => {
      const rect = 30 + 900 * Math.tan((degrees * Math.PI) / 180);
      return [200, 400 + line * 36, 200 + 900 + 1.2 * rect, 400 + line * 36 + 1.8 * rect] as const;
    });
    expect(tiltGrowth(boxes(0), 0, padding)).toBe(1);
    const slope = Math.tan((3 * Math.PI) / 180);
    const height = boxes(3)[0]![3] - boxes(3)[0]![1];
    // The loader bands at 0.5 / 1.8 of the median box height, divided by the growth.
    expect(height * (0.5 / 1.8)).toBeGreaterThan(36);
    expect((height * (0.5 / 1.8)) / tiltGrowth(boxes(3), slope, padding)).toBeLessThan(36 / 1.5);
  });

  it("keeps every row of a two-column table tilted up to 5 degrees on one line", async () => {
    for (const degrees of [3, 4.9, 5]) {
      const turn = (degrees * Math.PI) / 180;
      const regions = Array.from({ length: 20 }, (_, row) => [0, 1].map((column): Region => {
        const [cx, cy] = [550 + column * 1100, 300 + row * 36];
        const rect = 30 * Math.cos(turn) + 900 * Math.sin(turn);
        const [width, height] = [900 * Math.cos(turn) + 30 * Math.sin(turn) + 1.2 * rect, 1.8 * rect];
        const [x, y] = [cx * Math.cos(turn) - cy * Math.sin(turn), cx * Math.sin(turn) + cy * Math.cos(turn)];
        return [`row ${row} cell ${column}`, Math.round(x - width / 2), Math.round(y - height / 2), Math.round(width), Math.round(height), 0.99];
      })).flat();
      const lines = (await load({ widthPx: 2550, heightPx: 3300, regions })).pages[0]!.lines!.map((line) => line.text);
      expect(lines, `${degrees} degrees`).toEqual(Array.from({ length: 20 }, (_, row) => `row ${row} cell 0 row ${row} cell 1`));
    }
  });

  it("keeps every row of an invoice table tilted 0.8 degrees on one line", async () => {
    const lines = (await load(fixture("invoice.scan"))).pages[0]!.lines!.map((line) => line.text);
    const table = invoice.find((block) => block.table !== undefined)!.table!;
    for (const row of table) expect(lines, row.join(" ")).toContain(row.join(" "));
  });
});
