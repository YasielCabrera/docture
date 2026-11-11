import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentConverter, silentLogger, type LoadedDocument } from "docture";

const engine = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: engine.createWorker }));

const { DocumentLoaderTesseract } = await import("docture/loaders/tesseract");

const ctx = { signal: new AbortController().signal, logger: silentLogger };

type Word = [text: string, x0: number, y0: number, x1: number, y1: number, confidence: number];
interface Line { readonly row: [rowHeight: number, ascenders: number, descenders: number]; readonly words: Word[] }
interface Page { readonly widthPx: number; readonly heightPx: number; readonly blocks: Line[][][] }

const fixture = (name: string): Page =>
  JSON.parse(readFileSync(new URL(`../fixtures/ocr-geometry/${name}.tesseract.json`, import.meta.url), "utf8")) as Page;
const truth = JSON.parse(readFileSync(new URL("../fixtures/ocr-geometry/two-column.truth.json", import.meta.url), "utf8")) as { h?: string; p?: string }[];

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** Load a page as if tesseract.js had recognized it, at 300 DPI. */
async function load(page: Page): Promise<LoadedDocument> {
  engine.createWorker.mockImplementation(async () => ({
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => ({
      data: {
        text: "",
        confidence: 90,
        blocks: page.blocks.map((paragraphs) => ({
          paragraphs: paragraphs.map((lines) => ({
            lines: lines.map(({ row: [rowHeight, ascenders, descenders], words }) => ({
              rowAttributes: { rowHeight, ascenders, descenders },
              words: words.map(([text, x0, y0, x1, y1, confidence]) => ({ text, confidence, bbox: { x0, y0, x1, y1 } })),
            })),
          })),
        })),
      },
    })),
    terminate: vi.fn(async () => undefined),
  }));
  await using loader = new DocumentLoaderTesseract({ dpi: 300 });
  return loader.load({ bytes: pngHeader(page.widthPx, page.heightPx), mimeType: "image/png" }, ctx);
}

const markdown = async (loaded: LoadedDocument) => (await new DocumentConverter().convert({ loaded })).content;
const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("#"));
const flat = (text: string) => text.replace(/\s+/gu, " ");

afterEach(() => { engine.createWorker.mockReset(); });

describe("Tesseract text sizes", () => {
  it("gives every word on a line the line's size, whatever letters the word has", async () => {
    const loaded = await load(fixture("two-column.flatscan"));
    const line = loaded.pages[0]!.lines!.find((candidate) => candidate.text.startsWith("Operating costs rose in the"))!;
    const sizes = new Set(line.spans.filter((span) => span.x < 300).map((span) => span.style?.fontSize));
    expect(sizes.size).toBe(1);
    // 10pt body text.
    expect([...sizes][0]).toBeGreaterThan(9);
    expect([...sizes][0]).toBeLessThan(11);
  });

  it("turns larger lines into headings ranked by size, and no body line", async () => {
    const text = await markdown(await load(fixture("two-column.flatscan")));
    expect(headings(text)).toEqual(["# Annual Review", "## Operations", "## People", "## Outlook"]);
  });

  it("does not let an x-height misfitted to a row of figures make the row read large", async () => {
    // Rows of one 8.5pt table: Tesseract fitted the second an x-height 30% too large.
    const row = (rowHeight: number, ascenders: number, descenders: number, words: Word[]): Line => ({ row: [rowHeight, ascenders, descenders], words });
    const loaded = await load({
      widthPx: 2550,
      heightPx: 3300,
      blocks: [[[
        row(32.4, 7.4, 7.4, [["Revenue", 252, 593, 389, 618, 96], ["(1,499.5)", 1194, 591, 1332, 624, 96], ["6,786.9", 1550, 593, 1665, 621, 96], ["1,103.1", 1884, 593, 1998, 623, 96], ["-11.6%", 2223, 593, 2333, 618, 96]]),
        row(42.5, 10.5, 7, [["Admin", 251, 875, 348, 900, 96], ["expenses", 362, 881, 510, 908, 96], ["4,782.4", 1217, 876, 1332, 905, 96], ["(1,015.0)", 1527, 875, 1665, 908, 96], ["4,655.2", 1883, 876, 1998, 905, 96], ["-1.3%", 2243, 876, 2333, 902, 96]]),
      ]]],
    });
    const [revenue, admin] = loaded.pages[0]!.lines!.map((line) => line.spans[0]!.style!.fontSize!);
    expect(admin! / revenue!).toBeLessThan(1.1);
    expect(admin).toBeCloseTo(8.5, 0);
  });

  it("gives no size to a line set up the margin, whose boxes are as tall as its words are long", async () => {
    const loaded = await load({
      widthPx: 2550,
      heightPx: 3300,
      blocks: [[[{ row: [40, 8, 8], words: [["arXiv:2210.14476v2", 60, 900, 100, 1373, 90], ["[eess.SP]", 60, 1400, 100, 1693, 90]] }]]],
    });
    expect(loaded.pages[0]!.lines!.flatMap((line) => line.spans).map((span) => span.style?.fontSize)).toEqual([undefined, undefined]);
  });
});

describe("Tesseract on a tilted page", () => {
  it("reads a two-column page tilted 0.8 degrees column by column", async () => {
    const text = flat(await markdown(await load(fixture("two-column.scan"))));
    for (const block of truth) {
      if (block.p !== undefined) expect(text).toContain(block.p);
    }
    expect(headings(await markdown(await load(fixture("two-column.scan"))))).toEqual(["# Annual Review", "## Operations", "## People", "## Outlook"]);
  });
});
