import { describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type LoadedDocument, type TableElement } from "docture";
import { boldRow, fixtureDocument, row, text, type FixtureLine } from "./continuation-fixtures.js";

async function convert(loaded: LoadedDocument): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const texts = (result: ConversionResult): string[] =>
  result.pages.flatMap((page) => page.elements.flatMap((element) => "text" in element ? [element.text] : []));

const tagged = (loaded: LoadedDocument): LoadedDocument => ({
  ...loaded,
  pages: loaded.pages.map((page) => ({
    ...page,
    blocks: (page.blocks ?? []).map((block) => block.kind === "text" ? { ...block, role: "paragraph" as const } : block),
  })),
});

const header = row(100, ["Date", 40], ["Description", 110], ["Debits", 300], ["Credits", 380], ["Balance", 460]);
const deposit = (y: number, date: string, amount: string, balance: string): FixtureLine =>
  row(y, [date, 40], ["Deposit", 110], [amount, 380], [balance, 460]);

describe("a statement table", () => {
  it("keeps a debits column that the first rows leave empty, and joins a wrapped description", async () => {
    const result = await convert(fixtureDocument([
      header,
      deposit(120, "07/01/2019", "$209.54", "$654.82"),
      deposit(140, "07/01/2019", "$389.77", "$1,044.59"),
      row(160, ["07/01/2019", 40], ["Card purchase at", 110], ["$21.70", 300], ["$1,022.89", 460]),
      row(172, ["Store 131", 110]),
      deposit(192, "07/02/2019", "$76.02", "$1,098.91"),
    ]));
    const [table] = tables(result);
    expect(tables(result)).toHaveLength(1);
    expect(table?.rows).toEqual([
      ["Date", "Description", "Debits", "Credits", "Balance"],
      ["07/01/2019", "Deposit", "", "$209.54", "$654.82"],
      ["07/01/2019", "Deposit", "", "$389.77", "$1,044.59"],
      ["07/01/2019", "Card purchase at Store 131", "$21.70", "", "$1,022.89"],
      ["07/02/2019", "Deposit", "", "$76.02", "$1,098.91"],
    ]);
    expect(table?.headerRows).toBe(1);
    expect(table?.rowProvenance?.[3]?.lineIds).toEqual(["p1-line-4", "p1-line-5"]);
  });

  it("reads amounts centred between the two lines of a description as one row", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Date", 40], ["Description", 110], ["Amount", 380], ["Balance", 460]),
      row(120, ["2/11", 40], ["Payroll", 110], ["508.76", 380], ["3,215.73", 460]),
      row(140, ["2/11", 40], ["Card 02/11", 110], ["31.82-", 380], ["3,183.91", 460]),
      row(158, ["Card 02/15 Hardware", 110]),
      row(164, ["2/16", 40], ["50.43-", 380], ["3,133.48", 460]),
      row(170, ["C#0000", 110]),
      row(188, ["2/16", 40], ["Insurance", 110], ["5.85-", 380], ["3,127.63", 460]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([[
      ["Date", "Description", "Amount", "Balance"],
      ["2/11", "Payroll", "508.76", "3,215.73"],
      ["2/11", "Card 02/11", "31.82-", "3,183.91"],
      ["2/16", "Card 02/15 Hardware C#0000", "50.43-", "3,133.48"],
      ["2/16", "Insurance", "5.85-", "3,127.63"],
    ]]);
  });

  it("keeps a source note set tight under the last row out of the table", async () => {
    const result = await convert(fixtureDocument([
      header,
      deposit(120, "07/01/2019", "$209.54", "$654.82"),
      deposit(140, "07/01/2019", "$389.77", "$1,044.59"),
      row(160, ["07/01/2019", 40], ["Card purchase", 110], ["$21.70", 300], ["$1,022.89", 460]),
      text(172, "Source: branch ledger"),
    ]));
    expect(tables(result)[0]?.rows.flat()).not.toContain("Source: branch ledger");
    expect(texts(result)).toContain("Source: branch ledger");
  });
});

const notices: readonly FixtureLine[] = [
  row(100, ["Notice", 40], ["Company", 150], ["No. Of", 345], ["Status", 420]),
  row(120, ["06/22/2015", 40], ["Long Beach Memorial Medical Center", 100], ["150", 325], ["Closure", 420]),
  row(140, ["06/30/2015", 40], ["ProCourier, Inc.", 100], ["137", 325], ["Layoff", 420]),
  row(160, ["07/01/2015", 40], ["Leidos", 100], ["72", 330], ["Layoff", 420]),
  row(180, ["07/02/2015", 40], ["Alphatec Spine", 100], ["99", 330], ["Layoff", 420]),
];

describe("a header row above a table", () => {
  it("leads the table when it names every column, though a label sits beside its column", async () => {
    const [table] = tables(await convert(fixtureDocument(notices)));
    expect(table?.rows[0]).toEqual(["Notice", "Company", "No. Of", "Status"]);
    expect(table?.headerRows).toBe(1);
    expect(table?.rows).toHaveLength(5);
  });

  it("reads lines that a tagged PDF marks as paragraphs as the same table", async () => {
    const [table] = tables(await convert(tagged(fixtureDocument(notices))));
    expect(table?.rows[0]).toEqual(["Notice", "Company", "No. Of", "Status"]);
    expect(table?.rows).toHaveLength(5);
  });

  it("starts a table with a single row under a bold header naming its columns", async () => {
    const result = await convert(fixtureDocument([
      text(60, "Invoice for services in January."),
      boldRow(100, ["Qty", 50], ["Service", 100], ["Rate", 350], ["Adjust", 440], ["Total", 510]),
      row(118, ["Web Design", 100]),
      row(123, ["1.00", 55], ["$85.00", 350], ["0.00%", 440], ["$85.00", 510]),
      row(129, ["A sample description", 100]),
      row(170, ["Sub Total", 400], ["$85.00", 510]),
    ]));
    expect(tables(result).map((table) => table.rows)).toEqual([[
      ["Qty", "Service", "Rate", "Adjust", "Total"],
      ["1.00", "Web Design A sample description", "$85.00", "0.00%", "$85.00"],
    ]]);
  });
});

describe("a table continued on the next page", () => {
  it("joins rows under a continued line repeating the title above the table, past a page number line", async () => {
    const result = await convert(fixtureDocument(
      [
        text(600, "TRANSACTIONS"),
        { ...header, y: 620 },
        deposit(640, "07/08/2019", "$141.19", "$1,128.86"),
        deposit(660, "07/08/2019", "$208.45", "$1,337.31"),
        row(680, ["07/08/2019", 40], ["Card purchase", 110], ["$21.70", 300], ["$1,315.61", 460]),
      ],
      [
        row(90, ["Page 2 of 2", 480]),
        text(120, "TRANSACTIONS (continued)"),
        { ...header, y: 140 },
        deposit(160, "07/09/2019", "$130.28", "$1,445.89"),
        deposit(180, "07/10/2019", "$238.74", "$1,684.63"),
      ],
    ));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows.slice(-2)).toEqual([
      ["07/09/2019", "Deposit", "", "$130.28", "$1,445.89"],
      ["07/10/2019", "Deposit", "", "$238.74", "$1,684.63"],
    ]);
    expect(texts(result)).toContain("Page 2 of 2");
  });
});

describe("OCR word boxes", () => {
  it("keeps the digit groups of a number together where they line up down a column", async () => {
    // OCR boxes each digit group; the groups of right-aligned figures line up row to row.
    const groups = (right: number, parts: readonly string[]): [string, number][] => {
      let x = right;
      return parts.toReversed().map((part): [string, number] => {
        x -= Math.max(10, part.length * 5);
        const cell: [string, number] = [part, x];
        x -= 6;
        return cell;
      }).toReversed();
    };
    const figures = (y: number, label: string, a: readonly string[], b: readonly string[]) =>
      row(y, [label, 40], ...groups(202, a), ...groups(270, b));
    const result = await convert(fixtureDocument([
      figures(100, "Gold", ["11", "171", "705"], ["10", "504", "466"]),
      figures(120, "Cash", ["378", "129"], ["13", "890", "137"]),
      figures(140, "Deposits", ["14", "236", "529"], ["828", "429"]),
      figures(160, "Other", ["901", "164"], ["17", "992", "593"]),
    ]));
    expect(tables(result)[0]?.rows.slice(0, 2)).toEqual([["Gold", "11 171 705", "10 504 466"], ["Cash", "378 129", "13 890 137"]]);
  });

  it("keeps a section number with its label when most rows have none", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["32", 40], ["1.5", 100], ["Dividends received", 122], ["76", 400], ["50", 450]),
      row(115, ["33", 40], ["1.6", 100], ["Other income", 122], ["922", 400], ["740", 450]),
      row(130, ["2", 100], ["Operating costs", 122], ["- 2 130", 400], ["- 2 360", 450]),
      row(145, ["34", 40], ["Staff costs", 122], ["- 1 025", 400], ["- 1 026", 450]),
      row(160, ["Pensions", 122], ["- 219", 400], ["- 540", 450]),
      row(175, ["Taxes", 122], ["- 34", 400], ["- 33", 450]),
      row(190, ["Depreciation", 122], ["- 170", 400], ["- 168", 450]),
      row(205, ["Other costs", 122], ["- 681", 400], ["- 593", 450]),
    ]));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows[0]).toEqual(["32", "1.5 Dividends received", "76", "50"]);
  });

  it("keeps a totals label whole when one of its words only grazes a column", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["#", 55], ["Description", 86], ["SKU", 305], ["Qty", 400], ["Unit", 444], ["Price", 470], ["Amount", 523]),
      row(120, ["1", 55], ["Copy", 86], ["paper", 112], ["PAP-A4", 305], ["12", 405], ["$24.90", 458], ["$298.80", 522]),
      row(140, ["2", 55], ["Ballpoint", 86], ["pens", 136], ["PEN-BL", 305], ["4", 410], ["$11.25", 458], ["$45.00", 527]),
      row(160, ["3", 55], ["Desk", 86], ["organizer", 112], ["ORG-BAM", 305], ["6", 410], ["$18.40", 458], ["$110.40", 522]),
      row(185, ["Subtotal", 426], ["$664.17", 521]),
      row(205, ["Total", 412], ["Due", 442], ["$717.30", 517]),
    ]));
    const [table] = tables(result);
    expect(table?.rows[1]).toEqual(["1", "Copy paper", "PAP-A4", "12", "$24.90", "$298.80"]);
    expect(table?.rows.at(-1)?.filter((cell) => cell !== "")).toEqual(["Total Due", "$717.30"]);
  });
});

/** `loaded` with the spans of the lines at `ys` set in `size` points. */
const sized = (loaded: LoadedDocument, ys: readonly number[], size: number): LoadedDocument => ({
  ...loaded,
  pages: loaded.pages.map((page) => ({
    ...page,
    blocks: (page.blocks ?? []).map((block) => block.kind !== "text" || !ys.includes(block.y) ? block : {
      ...block,
      lines: block.lines.map((line) => ({ ...line, spans: line.spans.map((span) => ({ ...span, style: { ...span.style, fontSize: size } })) })),
    }),
  })),
});

describe("type size", () => {
  const items = fixtureDocument([
    text(60, "Customer 2"),
    row(100, ["Qty", 40], ["Product", 100], ["Price", 400], ["Total", 480]),
    row(120, ["1,00", 40], ["Design", 100], ["160,00", 400], ["160,00", 480]),
    row(140, ["400,00", 40], ["Balloons", 100], ["0,79", 400], ["316,00", 480]),
    row(160, ["200,00", 40], ["Hot air", 100], ["0,10", 400], ["20,00", 480]),
    row(178, ["Rate", 100], ["Net", 400], ["Tax", 480]),
    row(192, ["7%", 100], ["160,00", 400], ["11,20", 480]),
    row(206, ["19%", 100], ["336,00", 400], ["63,84", 480]),
    text(260, "Please pay within 30 days."),
    text(400, "IBAN DE00 0000 0000 0000 0000 00, BIC TESTDEFFXXX"),
    text(412, "Registered office: Test City"),
  ]);
  const invoice = sized(sized(sized(items, [60, 100, 120, 140, 160, 260], 12), [178, 192, 206], 9), [400, 412], 7.5);

  it("ends a table where rows set in a much smaller size begin", async () => {
    const result = await convert(invoice);
    expect(tables(result)[0]?.rows.at(-1)).toEqual(["200,00", "Hot air", "0,10", "20,00"]);
  });

  it("does not make body text a heading when the page's other text is small print", async () => {
    const result = await convert(invoice);
    const markdown = (await new DocumentConverter().convert({ loaded: invoice }, { format: "markdown" })).content;
    expect(tables(result)).not.toHaveLength(0);
    expect(markdown).toContain("Customer 2");
    expect(markdown).not.toMatch(/^#+ Customer 2/mu);
  });
});

describe("an address beside an invoice's key-value details, read by OCR", () => {
  // Tesseract's words for a sample invoice's header: an address on the left and its
  // details on the right, whose lines sit at interleaved heights.
  const words: readonly (readonly (readonly [string, number, number, number, number, number])[])[] = [[["Invoice", 349.2, 119.3, 26.6, 6.5, 8.9], ["Number", 379.5, 119.3, 30.5, 6.5, 8.9], ["INV-3337", 452.9, 119.3, 36.0, 6.5, 7.7]], [["From:", 43.2, 124.8, 23.8, 6.7, 9.0]], [["DEMO", 43.2, 137.3, 25.4, 6.7, 8.9], ["-", 71.8, 140.9, 2.2, 0.7, 8.9], ["Sliced", 77.3, 137.3, 22.8, 6.5, 8.9], ["Invoices", 103.9, 137.3, 31.2, 6.5, 8.9], ["Order", 348.8, 134.9, 22.1, 6.7, 9.2], ["Number", 374.0, 135.1, 30.7, 6.5, 9.2], ["12345", 452.7, 135.1, 23.5, 6.5, 7.7]], [["Suite", 43.0, 149.8, 19.2, 6.7, 8.9], ["5A-1204", 65.3, 150.0, 32.6, 6.5, 8.9], ["Invoice", 349.2, 151.0, 26.6, 6.5, 8.9], ["Date", 379.5, 151.0, 17.5, 6.5, 8.9], ["January", 452.2, 151.0, 31.0, 8.2, 8.9], ["25,", 486.1, 151.0, 11.0, 7.4, 8.9], ["2016", 500.7, 151.0, 19.0, 6.5, 8.9]], [["123", 43.4, 162.7, 13.4, 6.2, 9.0], ["Somewhere", 60.0, 162.3, 46.3, 6.7, 9.0], ["Street", 109.5, 162.3, 22.8, 6.7, 9.0]], [["Due", 349.2, 166.8, 14.9, 6.5, 9.0], ["Date", 367.7, 166.8, 17.5, 6.5, 9.0], ["January", 452.2, 166.8, 31.0, 8.2, 9.0], ["31,", 485.8, 166.8, 11.3, 7.4, 9.0], ["2016", 500.7, 166.8, 19.0, 6.5, 9.0]], [["Your", 42.7, 175.0, 18.2, 6.7, 8.9], ["City", 63.8, 175.0, 14.6, 8.4, 8.9], ["AZ", 81.4, 175.0, 10.8, 6.5, 8.9], ["12345", 95.8, 175.2, 23.3, 6.5, 8.9]], [["Ee", 348.5, 182.7, 29.5, 6.2, 8.9], ["Ol", 354.0, 182.9, 12.7, 6.2, 9.2], ["2", 378.8, 184.1, 9.6, 5.0, 9.2], ["$93.50", 452.2, 182.2, 26.4, 7.9, 9.2]], [["admin@slicedinvoices.com", 43.0, 186.5, 105.4, 10.1, 9.2]]];
  const loaded: LoadedDocument = {
    loader: "ocr-fixture",
    form: "scanned",
    text: words.map((line) => line.map(([value]) => value).join(" ")).join("\n"),
    pages: [{
      pageNumber: 1,
      width: 595.28,
      height: 841.79,
      text: "",
      lines: words.map((line) => {
        const spans = line.map(([value, x, y, width, height, fontSize]) => ({ text: value, x, y, width, height, confidence: 0.9, style: { fontSize } }));
        const top = Math.min(...spans.map((span) => span.y));
        return { y: top, height: Math.max(...spans.map((span) => span.y + span.height)) - top, text: spans.map((span) => span.text).join(" "), spans };
      }),
    }],
  };

  it("keeps the details as their own table rather than one table across both", async () => {
    const result = await convert(loaded);
    expect(tables(result).flatMap((table) => table.rows)).toContainEqual(["Due Date", "January 31, 2016"]);
  });
});

describe("label and value lines", () => {
  it("still parts two columns of prose where one right-hand line is a lone figure", async () => {
    const left = ["The committee reviewed the annual", "budget and approved the plan to", "expand services in the northern", "district over the coming year.", "Members noted that costs rose", "faster than expected last year."];
    const right = ["Attendance figures for the year", "were the highest on record at", "12,450", "visitors, up from the previous", "year, with most arriving in the", "summer months."];
    const result = await convert(fixtureDocument(left.map((value, index) => row(100 + index * 13, [value, 40], [right[index]!, 320]))));
    const all = texts(result).join("\n");
    expect(all).toContain("expand services in the northern\ndistrict over the coming year.");
    expect(all).not.toContain("northern 12,450");
  });

  it("keeps each label with its amount rather than reading two columns", async () => {
    const result = await convert(fixtureDocument([
      text(100, "Fees and interest for the year."),
      row(130, ["Total fees charged in 2019", 40], ["$0.54", 400]),
      row(145, ["Total interest charged in 2019", 40], ["$99.90", 400]),
    ]));
    expect(texts(result)).toEqual([
      "Fees and interest for the year.",
      "Total fees charged in 2019 $0.54",
      "Total interest charged in 2019 $99.90",
    ]);
  });

  it("keeps labels with amounts in currency codes, and in right-to-left text", async () => {
    const latin = await convert(fixtureDocument([
      text(100, "Fees and interest for the year."),
      row(130, ["Total fees", 40], ["EUR 0,54", 400]),
      row(145, ["Total interest", 40], ["99,90 EUR", 400]),
    ]));
    expect(texts(latin).slice(1)).toEqual(["Total fees EUR 0,54", "Total interest 99,90 EUR"]);

    const arabic = fixtureDocument([
      row(130, ["٠٫٥٤", 40], ["إجمالي الرسوم", 400]),
      row(145, ["٩٩٫٩٠", 40], ["إجمالي الفوائد", 400]),
    ]);
    const rightToLeft: LoadedDocument = {
      ...arabic,
      pages: arabic.pages.map((page) => ({
        ...page,
        blocks: (page.blocks ?? []).map((block) => block.kind !== "text" ? block : {
          ...block,
          lines: block.lines.map((line) => ({ ...line, spans: line.spans.map((span) => ({ ...span, direction: "rtl" as const })) })),
        }),
      })),
    };
    const lines = texts(await convert(rightToLeft));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("٠٫٥٤");
    expect(lines[0]).toContain("إجمالي الرسوم");
  });

  it("still parts two columns of prose when a right-column line holds only a number", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Revenue rose in the north, while the west", 40], ["Costs in the south held steady through the year,", 330]),
      row(115, ["was flat and the east reported a small loss", 40], ["and imports fell for the second year in a row,", 330]),
      row(130, ["in the third quarter of the reporting year.", 40], ["as reported in the regional bulletin number", 330]),
      row(145, ["Exports grew again in the fourth quarter.", 40]),
      row(160, ["Imports were flat for the rest of the year.", 40], ["2012.04572", 330]),
      row(175, ["Prices held for the rest of the year too.", 40]),
    ]));
    expect(texts(result).join("\n")).not.toContain("year. 2012.04572");
  });
});

describe("OCR cell text", () => {
  it("drops a table rule read as a bracket or bar beside a number", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Date", 40], ["Count", 200], ["Note", 300]),
      row(120, ["|07/15/2015", 40], ["[150", 200], ["[1]", 300]),
      row(140, ["07/16/2015", 40], ["99]", 200], ["a | b", 300]),
      row(160, ["07/17/2015", 40], ["12", 200], ["none", 300]),
    ]));
    expect(tables(result)[0]?.rows.slice(1, 3)).toEqual([["07/15/2015", "150", "[1]"], ["07/16/2015", "99", "a | b"]]);
  });
});
