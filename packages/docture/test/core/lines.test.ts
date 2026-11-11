import { describe, expect, it } from "vitest";
import { linesFromWords, textFromLines, type PositionedWord } from "../../src/core/index.js";
import { estimateSkew } from "../../src/core/domain/lines.js";

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

/**
 * A table of `rows` x 5 cells turned `degrees` about the origin, as a tilted scan
 * reports it: each cell's box is axis-aligned around its turned centre. `height` is
 * the reported box height and `pitch` the distance between rows, so a padded OCR box
 * can be taller than the row pitch, as PaddleOCR's are in a dense table.
 */
function tiltedTable(degrees: number, { rows = 20, pitch = 12, height = 10, jitter = 0 } = {}): PositionedWord[] {
  const turn = (degrees * Math.PI) / 180;
  const columns = [40, 180, 300, 420, 540];
  return Array.from({ length: rows }, (_, row) => columns.map((x, column) => {
    const width = column === 0 ? 90 : 50;
    const [cx, cy] = [x + width / 2, 100 + row * pitch + height / 2];
    const shake = jitter * Math.sin(row * 7.3 + column * 3.1);
    const [tx, ty] = [cx * Math.cos(turn) - cy * Math.sin(turn), cx * Math.sin(turn) + cy * Math.cos(turn) + shake];
    const tall = height + width * Math.abs(Math.sin(turn));
    return { text: `r${row}c${column}`, box: [tx - width / 2, ty - tall / 2, tx + width / 2, ty + tall / 2] } as PositionedWord;
  })).flat();
}

/** A `width` x `height` word centred on `(x, y)` of a page turned `degrees` about the origin, boxed as a tilted scan reports it. */
function turned(text: string, x: number, y: number, width: number, height: number, degrees: number): PositionedWord {
  const turn = (degrees * Math.PI) / 180;
  const [sin, cos] = [Math.sin(turn), Math.cos(turn)];
  const [cx, cy] = [x * cos - y * sin, x * sin + y * cos];
  const [w, h] = [width * cos + height * Math.abs(sin), height * cos + width * Math.abs(sin)];
  return { text, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] };
}

const rowTexts = (rows: number) => Array.from({ length: rows }, (_, row) => [0, 1, 2, 3, 4].map((column) => `r${row}c${column}`).join(" "));

describe("linesFromWords on a tilted page", () => {
  it("splits a row of a tilted dense table when it groups by height alone", () => {
    const lines = linesFromWords(tiltedTable(2));
    expect(lines.map((line) => line.text)).not.toEqual(rowTexts(20));
  });

  it("keeps every row of a tilted table on one line, in order, when it estimates the skew", () => {
    const lines = linesFromWords(tiltedTable(1), { skew: "estimate" });
    expect(lines.map((line) => line.text)).toEqual(rowTexts(20));
  });

  it("never merges adjacent rows of a dense table, whatever the tilt", () => {
    for (const degrees of [-3, -1, -0.4, 0, 0.8, 2, 3]) {
      // Plain words: 10-unit text, rows 12 apart, OCR jitter of a tenth of the text height.
      const words = linesFromWords(tiltedTable(degrees, { jitter: 1 }), { skew: "estimate" });
      expect(words.map((line) => line.text), `${degrees} degrees`).toEqual(rowTexts(20));
      // PaddleOCR-style boxes, padded to 1.8 times the text and taller than the row pitch.
      const padded = linesFromWords(tiltedTable(degrees, { height: 18, jitter: 1 }), { skew: "estimate", lineTolerance: 0.28 });
      expect(padded.map((line) => line.text), `${degrees} degrees, padded`).toEqual(rowTexts(20));
    }
  });

  it("keeps the rows of a tilted two-column table apart when its wide padded boxes are taller than the row pitch", () => {
    // PaddleOCR-style regions: 900 wide, 30 tall text padded to 1.8 times, rows 36 apart, sized as the loader sizes them.
    for (const degrees of [3, 4.9, 5]) {
      const turn = (degrees * Math.PI) / 180;
      const [sin, cos] = [Math.sin(turn), Math.cos(turn)];
      const words = Array.from({ length: 20 }, (_, row) => [0, 1].map((column) => {
        const [cx, cy] = [550 + column * 1100, 100 + row * 36];
        const [x, y] = [cx * cos - cy * sin, cx * sin + cy * cos];
        const [width, height] = [900 * cos + 30 * sin, 1.8 * (30 * cos + 900 * sin)];
        return { text: `r${row}c${column}`, box: [x - width / 2, y - height / 2, x + width / 2, y + height / 2], style: { fontSize: 30 } } as PositionedWord;
      })).flat();
      const lines = linesFromWords(words, { skew: "estimate", lineTolerance: 0.5 / 1.8 });
      expect(lines.map((line) => line.text), `${degrees} degrees`).toEqual(Array.from({ length: 20 }, (_, row) => `r${row}c0 r${row}c1`));
    }
  });

  it("does not put two stacked lines of one column on one line of a tilted page", () => {
    // Padded 900-wide regions 3 degrees off: each box is 138 tall against a row pitch of 36, so the band reaches the next row.
    const slope = Math.tan((3 * Math.PI) / 180);
    const words = Array.from({ length: 8 }, (_, row) => word(`line ${row}`, 100, 100 + row * 36, 900, 1.8 * (30 + 900 * slope)));
    expect(linesFromWords(words, { skew: Math.atan(slope), lineTolerance: 0.5 / 1.8 }).map((line) => line.text)).toEqual(words.map((w) => w.text));
  });

  it("keeps overlapping boxes at one height on one line of a tilted page", () => {
    const words = [word("IE", 30, 100, 30, 15), word("Certification", 31, 101, 110, 13), word("Part", 200, 103, 30, 10)];
    expect(linesFromWords(words, { skew: (1 * Math.PI) / 180 })).toHaveLength(1);
  });

  it("keeps each item of a tilted two-column invoice on the line of its own amount", () => {
    // Description left, amount far right: the far cell drifts a whole row pitch or more over the gap.
    for (const degrees of [-3, -2, -1, 1, 2, 3]) {
      const words = Array.from({ length: 20 }, (_, row) => [
        turned(`Item${row}`, 100, 100 + row * 36, 100, 30, degrees),
        turned(`Price${row}`, 1200, 100 + row * 36, 100, 30, degrees),
      ]).flat();
      expect(linesFromWords(words, { skew: "estimate" }).map((line) => line.text), `${degrees} degrees`)
        .toEqual(Array.from({ length: 20 }, (_, row) => `Item${row} Price${row}`));
    }
  });

  it("keeps a raised mark, a duplicate box, and a fraction part on their line of a tilted page", () => {
    const line = [turned("before", 50, 100, 40, 10, 2), turned("base", 110, 100, 40, 10, 2), turned("after", 175, 100, 40, 10, 2)];
    const body = Array.from({ length: 8 }, (_, row) => Array.from({ length: 6 }, (_, index) => turned("word", 50 + index * 45, 150 + row * 20, 40, 10, 2))).flat();
    const marks = {
      superscript: turned("2", 128, 96.5, 6, 6, 2),
      duplicate: turned("base", 110, 103.5, 40, 10, 2),
      denominator: turned("4", 110, 103.5, 20, 6, 2),
    };
    for (const [name, mark] of Object.entries(marks)) {
      expect(linesFromWords([...line, mark], { skew: (2 * Math.PI) / 180 }), name).toHaveLength(1);
      expect(linesFromWords([...line, mark, ...body], { skew: "estimate" }), `${name}, estimated`).toHaveLength(9);
    }
  });

  it("follows a skew the caller already measured", () => {
    const lines = linesFromWords(tiltedTable(1), { skew: (1 * Math.PI) / 180 });
    expect(lines.map((line) => line.text)).toEqual(rowTexts(20));
  });

  it("groups an upright page exactly as it does without estimating", () => {
    const page = [...tiltedTable(0), word("A caption under the table", 40, 400, 200), word("Title", 40, 60, 80, 20)];
    expect(linesFromWords(page, { skew: "estimate" })).toEqual(linesFromWords(page));
  });
});

describe("estimateSkew", () => {
  it("measures the tilt of rows of words", () => {
    for (const degrees of [-2.5, -0.8, 0.8, 4]) {
      expect((estimateSkew(tiltedTable(degrees))! * 180) / Math.PI).toBeCloseTo(degrees, 1);
    }
  });

  it("reports an upright page as upright", () => {
    expect(estimateSkew(tiltedTable(0, { jitter: 1 }))).toBe(0);
  });

  it("has no estimate for a page with one region per line, whose regions never sit side by side", () => {
    const prose = Array.from({ length: 30 }, (_, row) => word(`line ${row}`, 40, 100 + row * 12, 400 + (row % 3) * 30));
    expect(estimateSkew(prose)).toBeUndefined();
  });

  it("does not line up stacked lines of different lengths and indents at an angle", () => {
    const paragraph = Array.from({ length: 30 }, (_, row) => word(`line ${row}`, 40 + (row % 4) * 25, 100 + row * 12, 300 + ((row * 37) % 160)));
    expect(estimateSkew(paragraph, { lineTolerance: 0.28 })).toBeUndefined();
  });

  it("looks no further than the caller allows", () => {
    expect(estimateSkew(tiltedTable(2), { maxDegrees: 1 })).toBeLessThanOrEqual((1 * Math.PI) / 180);
    expect(estimateSkew(tiltedTable(2), { maxDegrees: 0 })).toBe(0);
  });

  it("has no estimate from too few words to tell", () => {
    expect(estimateSkew([word("one", 0, 0), word("two", 40, 3)])).toBeUndefined();
  });

  it("does not tilt an upright page to join two columns whose rows sit half a line apart", () => {
    // Each column's rows are 24 apart and the right column's sit 12 lower: 2.29 degrees joins them row for row.
    const columns = Array.from({ length: 10 }, (_, row) => [word(`L${row}`, 40, 100 + row * 24, 100), word(`R${row}`, 340, 112 + row * 24, 100)]).flat();
    expect(estimateSkew(columns)).toBeUndefined();
    expect(linesFromWords(columns, { skew: "estimate" }).map((line) => line.text)).toEqual(linesFromWords(columns).map((line) => line.text));
  });

  it("does not tilt a sparse upright form to join labels set at different heights", () => {
    const form = [word("Name", 40, 100, 100), word("Address", 340, 112, 100), word("Date", 640, 124, 100)];
    expect(estimateSkew(form)).toBeUndefined();
    expect(linesFromWords(form, { skew: "estimate" }).map((line) => line.text)).toEqual(["Name", "Address", "Date"]);
  });

  it("rejects an angle that joins columns when the phrases on each line run level", () => {
    // Two upright columns of three-word lines, the right one half a line lower and close enough to look like one row at 1 degree.
    const columns = Array.from({ length: 12 }, (_, row) => [0, 1, 2, 3, 4, 5].map((index) => {
      const right = index >= 3;
      return word(`w${row}.${index}`, 40 + index * 34 + (right ? 300 : 0), 100 + row * 24 + (right ? 7 : 0), 30);
    })).flat();
    expect(estimateSkew(columns)).toBeUndefined();
    expect(linesFromWords(columns, { skew: "estimate" })).toHaveLength(24);
  });
});
