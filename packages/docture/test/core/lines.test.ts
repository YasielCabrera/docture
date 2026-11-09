import { describe, expect, it } from "vitest";
import { linesFromWords, textFromLines, type PositionedWord } from "../../src/core/index.js";

/** `[text, xMin, yMin, xMax, yMax]` — terser than object literals for a grid. */
function word(text: string, x: number, y: number, w = 30, h = 10): PositionedWord {
  return { text, box: [x, y, x + w, y + h] };
}

describe("linesFromWords", () => {
  it("groups words sharing a vertical band into one line, left to right", () => {
    const lines = linesFromWords([
      word("world", 80, 100),
      word("hello", 40, 100),
      word("again", 120, 100),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("hello world again");
  });

  it("separates rows and returns them top to bottom", () => {
    const lines = linesFromWords([
      word("third", 40, 140),
      word("first", 40, 100),
      word("second", 40, 120),
    ]);

    expect(lines.map((l) => l.text)).toEqual(["first", "second", "third"]);
    expect(lines[0]!.y).toBeLessThan(lines[1]!.y);
  });

  it("tolerates baseline jitter within the band but not across rows", () => {
    // ±2pt on a 10pt font is OCR noise, not a new row.
    const lines = linesFromWords([
      word("a", 40, 100),
      word("b", 80, 102),
      word("c", 120, 98),
      word("next", 40, 118),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("a b c");
    expect(lines[1]?.text).toBe("next");
  });

  it("scales coordinates, so an OCR engine on a 300-DPI raster lands in PDF points", () => {
    const lines = linesFromWords([word("scaled", 300, 600, 150, 50)], { scale: 72 / 300 });

    const span = lines[0]?.spans[0];
    expect(span?.x).toBeCloseTo(72);
    expect(span?.y).toBeCloseTo(144);
    expect(span?.width).toBeCloseTo(36);
  });

  it("scales the font size with the box, so word gaps on a 300-DPI raster are measured in one unit", () => {
    const styled = (text: string, x: number, w: number): PositionedWord => ({
      text, box: [x, 400, x + w, 440], style: { fontSize: 40 },
    });
    const lines = linesFromWords([styled("Gulf", 200, 70), styled("Coast", 280, 90)], { scale: 72 / 300 });
    expect(lines[0]?.text).toBe("Gulf Coast");
    expect(lines[0]?.spans.map((span) => span.style?.fontSize)).toEqual([9.6, 9.6]);
  });

  it("drops blank words rather than letting them widen a line box", () => {
    const lines = linesFromWords([word("real", 40, 100), word("   ", 200, 100)]);
    expect(lines[0]?.spans).toHaveLength(1);
    expect(lines[0]?.text).toBe("real");
  });

  it("returns nothing for no words, and for only-blank words", () => {
    expect(linesFromWords([])).toEqual([]);
    expect(linesFromWords([word("", 0, 0), word("  ", 10, 0)])).toEqual([]);
  });

  it("carries confidence through when the producer reports it", () => {
    const lines = linesFromWords([{ text: "ocr", box: [0, 0, 10, 10], confidence: 0.87 }]);
    expect(lines[0]?.spans[0]?.confidence).toBeCloseTo(0.87);
  });

  it("survives degenerate zero-height boxes", () => {
    const lines = linesFromWords([
      { text: "flat", box: [0, 50, 20, 50] },
      { text: "also", box: [30, 50, 50, 50] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("flat also");
  });

  it("honours a widened tolerance by merging rows that would otherwise split", () => {
    const words = [word("a", 40, 100), word("b", 40, 118)];
    expect(linesFromWords(words)).toHaveLength(2);
    expect(linesFromWords(words, { lineTolerance: 3 })).toHaveLength(1);
  });

  it("follows a drifting baseline, as a rotated scan produces", () => {
    // Each word sits 1pt lower than the last: one line, not eight.
    const drifting = Array.from({ length: 8 }, (_, i) => word(`w${i}`, 40 + i * 35, 100 + i));
    expect(linesFromWords(drifting)).toHaveLength(1);
  });

  it("joins text-layer runs that touch without inventing a space", () => {
    const lines = linesFromWords([
      word("(", 36, 100, 3.2),
      word("Newkirk, 1971", 39.2, 100, 60),
      word(";", 99.2, 100, 2.5),
      word("figure", 110, 100, 25),
      word("1", 137.5, 100, 5),
      word(".", 142.5, 100, 2.5),
    ]);
    expect(lines[0]?.text).toBe("(Newkirk, 1971; figure 1.");
  });

  it("measures word gaps against the font size when the box is a taller line box", () => {
    const styled = (text: string, x: number, w: number): PositionedWord => ({
      text, box: [x, 100, x + w, 112.8], style: { fontFamily: "Univers", fontSize: 9.5 },
    });
    const lines = linesFromWords([styled("Florida.", 40, 30), styled("A", 71.66, 6), styled("sixth", 79.32, 20)]);
    expect(lines[0]?.text).toBe("Florida. A sixth");
  });

  it("keeps a narrow space between Latin words of one font, as CJK fonts set them", () => {
    const styled = (text: string, x: number, w: number): PositionedWord => ({
      text, box: [x, 100, x + w, 109.6], style: { fontFamily: "ULJJTA+FZDHTJW--GB1-0", fontSize: 8.4 },
    });
    const lines = linesFromWords([styled("Treasury", 409, 37), styled("Inspector", 446.64, 39), styled("General", 486.28, 33)]);
    expect(lines[0]?.text).toBe("Treasury Inspector General");
  });

  it("joins touching runs of one font at punctuation", () => {
    const styled = (text: string, x: number, w: number): PositionedWord => ({
      text, box: [x, 67, x + w, 76], style: { fontFamily: "ArialMT", fontSize: 9 },
    });
    const lines = linesFromWords([styled("(", 421, 3), styled("316)777-1171", 424, 56)]);
    expect(lines[0]?.text).toBe("(316)777-1171");
  });

  it("keeps the space before a raised footnote mark and between text drawn twice", () => {
    const lines = linesFromWords([
      word("proportion", 40, 100, 50, 10),
      word("1", 90, 99, 3, 6),
      word("(NBER).", 120, 100, 30),
      word("(NBER).", 120, 100, 30),
    ]);
    expect(lines[0]?.text).toBe("proportion 1 (NBER). (NBER).");
  });

  it("joins small capitals that share a baseline", () => {
    const lines = linesFromWords([word("I", 40, 100, 4, 10), word("NDUSTRIAL", 44, 102, 50, 8)]);
    expect(lines[0]?.text).toBe("INDUSTRIAL");
  });

  it("does not double a space a run already carries", () => {
    const lines = linesFromWords([word("Hello ", 40, 100, 30), word("world", 75, 100, 25)]);
    expect(lines[0]?.text).toBe("Hello world");
  });

  it("keeps rotated words on their own line, read along their baseline", () => {
    const up = (text: string, y: number, h: number): PositionedWord => ({ text, box: [12, y, 32, y + h], rotation: 90 });
    const lines = linesFromWords([
      word("Sinusoidal", 40, 400, 60),
      word("estimation", 104, 400, 60),
      up("[eess.SP]", 300, 60),
      up("arXiv:2210.14476v2", 380, 160),
    ]);
    expect(lines.map((line) => line.text)).toEqual(["arXiv:2210.14476v2 [eess.SP]", "Sinusoidal estimation"]);
  });

  it("bands words of a slightly skewed text layer with the line they belong to", () => {
    const skewed = (text: string, x: number, y: number): PositionedWord => ({ ...word(text, x, y), rotation: 2 });
    const lines = linesFromWords([word("scanned", 40, 100), skewed("text", 75, 100), skewed("layer", 110, 101)]);
    expect(lines.map((line) => line.text)).toEqual(["scanned text layer"]);
  });

  it("orders right-to-left runs from the right edge", () => {
    const rtl = (text: string, x: number): PositionedWord => ({ ...word(text, x, 100, 30), direction: "rtl" });
    const lines = linesFromWords([rtl("שלום", 200), rtl("עולם", 160), rtl("טוב", 120)]);
    expect(lines[0]?.text).toBe("שלום עולם טוב");
    expect(lines[0]?.spans.map((span) => span.x)).toEqual([200, 160, 120]);
  });
});

describe("textFromLines", () => {
  it("joins lines in reading order", () => {
    const lines = linesFromWords([word("one", 40, 100), word("two", 40, 120)]);
    expect(textFromLines(lines)).toBe("one\ntwo");
  });
});
