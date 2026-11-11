import { expect, it } from "vitest";
import { DocumentConverter, type TextLine, type TextSpan } from "../../src/core/index.js";

const cell = (text: string, x: number, y: number, width: number): TextSpan => ({ text, x, y, width, height: 10 });
const line = (y: number, spans: TextSpan[]): TextLine => ({ text: spans.map((span) => span.text).join(" "), y, height: 10, spans });
async function tables(lines: TextLine[]) {
  const text = lines.map((row) => row.text).join("\n");
  const result = await new DocumentConverter().convert({ loaded: {
    loader: "geometry", form: "digital", text,
    pages: [{ pageNumber: 1, width: 600, height: 800, text, lines }],
  } }, { format: "markdown" });
  return result.pages.flatMap((page) => page.elements.filter((element) => element.kind === "table"));
}

it("keeps right-aligned headers whose left edges differ from their values", async () => {
  const rows = [
    line(100, [cell("Description", 30, 100, 60), cell("Unit price", 240, 100, 60), cell("Amount", 400, 100, 50)]),
    line(120, [cell("Coupling", 30, 120, 45), cell("9.75", 276, 120, 24), cell("19.50", 420, 120, 30)]),
    line(140, [cell("Bracket", 30, 140, 40), cell("100.00", 264, 140, 36), cell("200.00", 414, 140, 36)]),
  ];
  expect((await tables(rows))[0]?.rows[0]).toEqual(["Description", "Unit price", "Amount"]);
});

it("joins a close continuation inside a column without vector rulings", async () => {
  const rows = [
    line(100, [cell("Part", 30, 100, 25), cell("Material", 150, 100, 40), cell("Notes", 300, 100, 30)]),
    line(124, [cell("Housing", 30, 124, 45), cell("Alloy", 150, 124, 30), cell("Machine all mating", 300, 124, 160)]),
    line(136, [cell("faces", 300, 136, 25)]),
    line(160, [cell("Cover", 30, 160, 30), cell("Plastic", 150, 160, 35), cell("Keep dry", 300, 160, 50)]),
    line(184, [cell("Seal", 30, 184, 25), cell("Rubber", 150, 184, 35), cell("Replace yearly", 300, 184, 75)]),
    line(210, [cell("A separate paragraph outside the table columns.", 30, 210, 440)]),
  ];
  expect((await tables(rows))[0]?.rows).toEqual([
    ["Part", "Material", "Notes"], ["Housing", "Alloy", "Machine all mating faces"],
    ["Cover", "Plastic", "Keep dry"], ["Seal", "Rubber", "Replace yearly"],
  ]);
});

it("does not turn three columns of wrapping prose into a table", async () => {
  const rows = [100, 112, 124, 136].map((y, index) => line(y, [30, 210, 390].map((x) =>
    cell(index % 2 === 0 ? "A long sentence continues" : "onto the following line.", x, y, 160))));
  expect(await tables(rows)).toEqual([]);
});

it("does not attach an equally spaced new row label to the preceding row", async () => {
  const rows = [
    line(100, [cell("Part", 30, 100, 25), cell("Qty", 250, 100, 20), cell("Cost", 400, 100, 25)]),
    line(112, [cell("Previous product", 30, 112, 110), cell("2", 250, 112, 10), cell("10", 400, 112, 20)]),
    line(124, [cell("Electrical equipment", 30, 124, 100)]),
    line(136, [cell("and components", 30, 136, 85), cell("3", 250, 136, 10), cell("20", 400, 136, 20)]),
    line(148, [cell("Other product", 30, 148, 80), cell("4", 250, 148, 10), cell("30", 400, 148, 20)]),
  ];
  for (const table of await tables(rows)) {
    expect(table.rows.flat()).not.toContain("Previous product Electrical equipment");
  }
});

it("keeps prose columns out of tables even below bold column headings", async () => {
  const heading = line(80, [30, 300].map((x) => ({ ...cell("Section", x, 80, 45), style: { bold: true } })));
  const body = [100, 112, 124, 136].map((y, index) => line(y, [30, 300].map((x) =>
    cell(index % 2 === 0 ? "A long sentence continues" : "onto the following line.", x, y, 180))));
  expect(await tables([heading, ...body])).toEqual([]);
});
