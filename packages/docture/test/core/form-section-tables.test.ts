import { describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type LoadedDocument, type TableElement } from "docture";
import { formSection } from "../../src/testing/fixtures/conversion-corpus/form-section.js";
import { corpusDocument, letter, line } from "../../src/testing/fixtures/conversion-corpus/layout.js";
import { fixtureDocument, row, text, type FixtureLine } from "./continuation-fixtures.js";

async function convert(loaded: LoadedDocument): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const texts = (result: ConversionResult): string[] =>
  result.pages.flatMap((page) => page.elements.flatMap((element) => "text" in element ? [element.text] : []));

const stay = (labelsAt: number): readonly FixtureLine[] => [
  row(100, ["Check In", 300], ["Check Out", 400], ["Rooms", 500]),
  row(120, ["31/12/2017", 300], ["01/01/2018", 400], ["1", 500]),
  row(140, ["02/01/2018", 300], ["03/01/2018", 400], ["2", 500]),
  row(labelsAt, ["Booking ID", 300], ["Payment Mode", 400]),
  row(labelsAt + 20, ["IBZY2087", 300], ["Cash at Hotel", 400]),
  text(300, "Thank you for staying with us."),
];

describe("a form section under a table in the same columns", () => {
  it("keeps the receipt's Booking ID section out of the Check In table", async () => {
    const result = await convert(formSection.loaded);
    expect(tables(result).map((table) => table.rows)).toEqual([]);
    expect(texts(result).slice(2, 9)).toEqual([
      "Hotel Details",
      "OYO 4189 Resort Nanganallur,",
      "25,Vembuliamman Koil Street,, Pazhavanthangal, Chennai",
      "Check In Check Out Rooms",
      "31/12/2017 01/01/2018 1",
      "Booking ID Payment Mode",
      "IBZY2087 Cash at Hotel",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it.each([["twice", 180], ["2.17 times", 183.4]])("ends the table at labels %s the row spacing below it", async (_case, labelsAt) => {
    const result = await convert(fixtureDocument(stay(labelsAt)));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Check In", "Check Out", "Rooms"], ["31/12/2017", "01/01/2018", "1"], ["02/01/2018", "03/01/2018", "2"]],
    ]);
    expect(tables(result)[0]?.sourceText).toBe("Check In Check Out Rooms\n31/12/2017 01/01/2018 1\n02/01/2018 03/01/2018 2");
    expect(texts(result)).toEqual(["Booking ID Payment Mode", "IBZY2087 Cash at Hotel", "Thank you for staying with us."]);
    expect(result.warnings).toEqual([]);
  });

  it("joins a totals row with a value in the amount column after a wider gap", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Item", 40], ["Qty", 300], ["Amount", 450]),
      row(120, ["Alpha", 40], ["1", 300], ["10", 450]),
      row(140, ["Beta", 40], ["2", 300], ["20", 450]),
      row(180, ["Total", 300], ["30", 450]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Qty", "Amount"], ["Alpha", "1", "10"], ["Beta", "2", "20"], ["", "Total", "30"]],
    ]);
  });

  it("ends the table at a label whose value holds words after a wider gap", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Item", 40], ["Qty", 300], ["Amount", 450]),
      row(120, ["Alpha", 40], ["1", 300], ["10", 450]),
      row(140, ["Beta", 40], ["2", 300], ["20", 450]),
      row(180, ["Payment method", 40], ["Visa ending 1234", 450]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([
      [["Item", "Qty", "Amount"], ["Alpha", "1", "10"], ["Beta", "2", "20"]],
    ]);
    expect(texts(result)).toEqual(["Payment method Visa ending 1234"]);
  });

  it("keeps a wrapped cell line that follows its row closely", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Item", 40], ["Qty", 300], ["Amount", 450]),
      row(120, ["Alpha", 40], ["1", 300], ["10", 450]),
      row(140, ["Beta, imported", 40], ["2 boxes", 300], ["20", 450]),
      row(152, ["from Norway", 40], ["of ten", 300]),
      row(172, ["Gamma", 40], ["3", 300], ["30", 450]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([[
      ["Item", "Qty", "Amount"], ["Alpha", "1", "10"], ["Beta, imported", "2 boxes", "20"], ["from Norway", "of ten", ""], ["Gamma", "3", "30"],
    ]]);
  });
});

describe("two-column reading order", () => {
  it("keeps the lines that share a row with a line spanning both columns", async () => {
    const result = await convert(fixtureDocument([
      text(100, "Left one"),
      row(100, ["Right one", 400]),
      text(120, "Left two"),
      row(120, ["Right two", 400]),
      text(140, "Closing Date"),
      row(140, ["07/31/2019 Statement Date 07/31/2019", 250]),
      row(140, ["Note", 480]),
      text(160, "Left three"),
      row(160, ["Right three", 400]),
    ]));
    expect(texts(result)).toEqual([
      "Left one", "Left two", "Closing Date", "Right one", "Right two", "07/31/2019 Statement Date 07/31/2019", "Note", "Left three", "Right three",
    ]);
  });

  it("reads each of two overlapping spanning lines once", async () => {
    const result = await convert(fixtureDocument([
      text(100, "Left one"),
      row(100, ["Right one", 400]),
      text(120, "Left two"),
      row(120, ["Right two", 400]),
      row(140, ["07/31/2019 Statement Date 07/31/2019", 250]),
      row(146, ["Account summary for the period ending 07/31/2019", 200]),
      text(170, "Left three"),
      row(170, ["Right three", 400]),
    ]));
    expect(texts(result)).toEqual([
      "Left one", "Left two", "Right one", "Right two", "07/31/2019 Statement Date 07/31/2019",
      "Account summary for the period ending 07/31/2019", "Left three", "Right three",
    ]);
  });

  it("emits every source line exactly once on randomly placed lines", async () => {
    let seed = 99991;
    const random = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const converter = new DocumentConverter();
    const failures: number[] = [];
    for (let trial = 0; trial < 500; trial += 1) {
      const loaded = corpusDocument(letter(...Array.from({ length: 10 }, (_unused, index) =>
        line(Math.floor(random() * 680) + 60, [`Paragraph ${index} ${"text ".repeat(15)}`, Math.floor(random() * 450) + 20, Math.floor(random() * 450) + 10]))));
      const result = await converter.convert({ loaded }, { format: "json" });
      const ids = result.pages.flatMap((page) => page.elements.flatMap((element) => element.provenance.sourceIds)).sort();
      if (ids.join() !== loaded.pages[0]?.blocks?.map((block) => block.id).sort().join()) failures.push(trial);
    }
    expect(failures).toEqual([]);
  });

  it("reads a label beside the spanning line before the value on the next row", async () => {
    const result = await convert(fixtureDocument([
      text(100, "Left one"),
      row(100, ["Right one", 400]),
      text(120, "Left two"),
      row(120, ["Right two", 400]),
      text(140, "Closing Date"),
      row(140, ["07/31/2019 Statement Date 07/31/2019", 250]),
      row(140, ["Balance", 480]),
      text(160, "Left three"),
      row(160, ["$123", 480]),
    ]));
    expect(texts(result).slice(5)).toEqual(["07/31/2019 Statement Date 07/31/2019", "Balance", "Left three", "$123"]);
  });
});
