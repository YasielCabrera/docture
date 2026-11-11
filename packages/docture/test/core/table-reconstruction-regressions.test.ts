import { expect, it } from "vitest";
import { DocumentConverter, parseDoctureDocument, type TextLayoutBlock, type TextLine, type TextSpan } from "../../src/core/index.js";

const cell = (text: string, x: number, y: number, width: number, extra: Partial<TextSpan> = {}): TextSpan => ({ text, x, y, width, height: 10, style: { fontSize: 10 }, ...extra });
const line = (y: number, spans: TextSpan[]): TextLine => ({ text: spans.map((span) => span.text).join(" "), y, height: 10, spans });
async function convert(lines: TextLine[], blocks?: TextLayoutBlock[]) {
  const text = lines.map((row) => row.text).join("\n");
  const loaded = { loader: "geometry", form: "digital" as const, text,
    pages: [{ pageNumber: 1, width: 600, height: 800, text, lines, ...(blocks ? { blocks } : {}) }] };
  const md = await new DocumentConverter().convert({ loaded }, { format: "markdown" });
  const json = await new DocumentConverter().convert({ loaded }, { format: "json" });
  return { md: md.content, tables: md.pages.flatMap((p) => p.elements.filter((e) => e.kind === "table")), json: JSON.parse(json.content) };
}

it("JSON with a joined continuation validates", async () => {
  const out = await convert([
    line(100, [cell("Part", 30, 100, 25), cell("Material", 150, 100, 40), cell("Notes", 300, 100, 30)]),
    line(124, [cell("Housing", 30, 124, 45), cell("Alloy", 150, 124, 30), cell("Machine all mating", 300, 124, 160)]),
    line(136, [cell("faces", 300, 136, 25)]),
    line(160, [cell("Cover", 30, 160, 30), cell("Plastic", 150, 160, 35), cell("Keep dry", 300, 160, 50)]),
    line(184, [cell("Seal", 30, 184, 25), cell("Rubber", 150, 184, 35), cell("Replace yearly", 300, 184, 75)]),
  ]);
  const parsed = parseDoctureDocument(out.json);
  expect(parsed.ok).toBe(true);
  const table = out.tables[0];
  expect(table?.rows[1]?.[2]).toBe("Machine all mating faces");
  expect(table?.rowProvenance?.[1]?.box).toMatchObject({ y: 124, height: 22 });
  expect(table?.rowProvenance?.[1]?.lineIds).toHaveLength(2);
});

it("a source note set tight under a table stays out of its last row", async () => {
  const out = await convert([
    line(100, [cell("Item", 30, 100, 25), cell("2023", 300, 100, 25), cell("2024", 420, 100, 25)]),
    line(120, [cell("Revenue", 30, 120, 45), cell("120", 305, 120, 20), cell("140", 425, 120, 20)]),
    line(140, [cell("Cost of sales", 30, 140, 70), cell("80", 310, 140, 15), cell("90", 430, 140, 15)]),
    line(160, [cell("Total operating expenses", 30, 160, 130), cell("40", 310, 160, 15), cell("50", 430, 160, 15)]),
    line(172, [cell("Source: annual report", 30, 172, 110)]),
  ]);
  expect(out.tables[0]?.rows.flat().join("|")).not.toContain("Source");
});

it.each([false, true])("tight numeric columns stay separate (tagged: %s)", async (tagged) => {
  const rows = [
    line(100, [cell("Region", 30, 100, 40), cell("Q1", 300, 100, 14), cell("Q2", 320, 100, 14), cell("Q3", 340, 100, 14)]),
    line(120, [cell("North", 30, 120, 30), cell("12", 300, 120, 12), cell("14", 320, 120, 12), cell("16", 340, 120, 12)]),
    line(140, [cell("South", 30, 140, 30), cell("10", 300, 140, 12), cell("11", 320, 140, 12), cell("13", 340, 140, 12)]),
  ];
  const blocks: TextLayoutBlock[] | undefined = tagged ? rows.map((row, i) => ({
    id: `row-${i}`, kind: "text", role: "table", x: 30, y: row.y, width: 324, height: 10, lines: [row],
  })) : undefined;
  const out = await convert(rows, blocks);
  expect(out.tables[0]?.rows[0]).toEqual(["Region", "Q1", "Q2", "Q3"]);
});

it("right-aligned letterhead metadata is not a table", async () => {
  const out = await convert([
    line(100, [cell("Northwind Traders", 30, 100, 95), cell("Invoice 1042", 500, 100, 70)]),
    line(114, [cell("12 Harbour Road", 30, 114, 85), cell("Issued 3 March 2024", 465, 114, 105)]),
    line(128, [cell("Portsmouth", 30, 128, 60), cell("Due 2 April 2024", 482, 128, 88)]),
    line(170, [cell("Thank you for your business. Payment is due within thirty days of the date above.", 30, 170, 450)]),
  ]);
  expect(out.tables).toEqual([]);
});

it.each([undefined, 10])("OCR columns survive font size metadata (%s)", async (fontSize) => {
  const values = [["Item", "Qty", "Price"], ["Bolt", "4", "1.20"], ["Nut", "12", "0.40"], ["Washer", "30", "0.05"]];
  const rows = values.map((values, i) => {
    const y = 100 + i * 18;
    return line(y, values.map((text, col) => cell(text, [30, 79, 106][col] ?? 0, y, [40, 18, 24][col] ?? 0,
      { height: 7, style: fontSize === undefined ? {} : { fontSize } })));
  });
  const out = await convert(rows);
  expect(out.tables[0]?.rows).toEqual(values);
});

it("a word-level table stays one table past a row whose cell spans several words", async () => {
  const word = (text: string, x: number, y: number, width: number) => cell(text, x, y, width, { height: 9, style: {} });
  const row = (y: number, spans: TextSpan[]): TextLine => ({ ...line(y, spans), height: 9 });
  const out = await convert([
    row(100, [word("Item", 30, 100, 30), word("Qty", 200, 100, 20), word("Price", 300, 100, 30)]),
    row(118, [word("Bolt", 30, 118, 25), word("4", 205, 118, 8), word("1.20", 300, 118, 25)]),
    row(136, [word("Nut", 30, 136, 20), word("12", 205, 136, 14), word("0.40", 300, 136, 25)]),
    row(154, [word("Hex", 30, 154, 22), word("washer", 55, 154, 40), word("30", 205, 154, 14), word("0.05", 300, 154, 25)]),
    row(172, [word("Rivet", 30, 172, 30), word("100", 205, 172, 20), word("0.02", 300, 172, 25)]),
    row(190, [word("Pin", 30, 190, 20), word("7", 205, 190, 8), word("0.10", 300, 190, 25)]),
  ]);
  expect(out.tables).toHaveLength(1);
  expect(out.tables[0]?.headerRows).toBe(1);
  expect(out.tables[0]?.rows).toContainEqual(["Hex washer", "30", "0.05"]);
});

it("a longer word-grouped table never wins by merging columns set tight together", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => {
    const y = 100 + index * 20;
    const label = index === 3 ? [cell("North", 30, y, 25), cell("East", 58, y, 20)] : [cell(index === 0 ? "Region" : "South", 30, y, 40)];
    const figures = index === 0 ? ["Q1", "Q2", "Q3"] : ["12", "14", "16"];
    return line(y, [...label, ...figures.map((text, column) => cell(text, 300 + column * 20, y, 14))]);
  });
  const out = await convert(rows);
  expect(out.tables[0]?.rows[0]).toEqual(["Region", "Q1", "Q2", "Q3"]);
  expect(out.md).not.toContain("Q1 Q2 Q3");
});
