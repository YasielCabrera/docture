import { describe, expect, it } from "vitest";
import { linesFromWords, textFromLines, type PositionedWord } from "../src/index.js";

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
});

describe("textFromLines", () => {
  it("joins lines in reading order", () => {
    const lines = linesFromWords([word("one", 40, 100), word("two", 40, 120)]);
    expect(textFromLines(lines)).toBe("one\ntwo");
  });
});
