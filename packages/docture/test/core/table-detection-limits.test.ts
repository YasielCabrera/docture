import { describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type LoadedDocument, type TableElement } from "docture";
import { boldRow, fixtureDocument, row, tableAtPageBottom, text } from "./continuation-fixtures.js";

async function convert(loaded: LoadedDocument): Promise<ConversionResult> {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const tables = (result: ConversionResult): TableElement[] =>
  result.pages.flatMap((page) => page.elements.filter((element): element is TableElement => element.kind === "table"));

const texts = (result: ConversionResult): string[] =>
  result.pages.flatMap((page) => page.elements.flatMap((element) => "text" in element ? [element.text] : []));

/** `loaded` with the spans of the lines at each y in `sizes` set in that size. */
function withSizes(loaded: LoadedDocument, sizes: ReadonlyMap<number, number>): LoadedDocument {
  for (const page of loaded.pages) {
    for (const block of page.blocks ?? []) {
      if (block.kind !== "text") continue;
      for (const line of block.lines) {
        const size = sizes.get(line.y);
        if (size !== undefined) for (const span of line.spans) Object.assign(span, { style: { ...span.style, fontSize: size } });
      }
    }
  }
  return loaded;
}

const sectionRows = [
  row(140, ["Item", 40], ["Amount", 200]),
  row(160, ["Gamma", 40], ["30", 200]),
  row(180, ["Delta", 40], ["40", 200]),
];

describe("a repeated header at the top of the next page", () => {
  it("starts a new table under a bold section title", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, [boldRow(100, ["Results for 2020", 40]), ...sectionRows]));
    expect(tables(result)).toHaveLength(2);
    expect(texts(result)).toContain("Results for 2020");
  });

  it("starts a new table under a paragraph of its own", async () => {
    const result = await convert(fixtureDocument(tableAtPageBottom, [text(100, "The second region reported these figures."), ...sectionRows]));
    expect(tables(result)).toHaveLength(2);
  });
});

describe("a line above a table", () => {
  it("does not become the header when its cells sit far from the columns", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Prepared by: Ana Ruiz", 40], ["Page 1", 480]),
      row(130, ["Alpha", 40], ["10", 200]),
      row(150, ["Beta", 40], ["20", 200]),
      row(170, ["Gamma", 40], ["30", 200]),
    ]));
    expect(tables(result)[0]?.rows[0]).toEqual(["Alpha", "10"]);
    expect(texts(result).join("\n")).toContain("Prepared by: Ana Ruiz");
  });

  it("does not become the header when the table already has one", async () => {
    const result = await convert(fixtureDocument([
      row(80, ["Account holder: Ana Ruiz", 40], ["Account no: 5521", 300]),
      row(100, ["Item", 60], ["Amount", 320]),
      row(120, ["Alpha", 40], ["10", 330]),
      row(140, ["Beta", 40], ["20", 330]),
      row(160, ["Gamma", 40], ["30", 330]),
    ]));
    expect(tables(result)[0]?.rows[0]).not.toEqual(["Account holder: Ana Ruiz", "Account no: 5521"]);
    expect(texts(result).join("\n")).toContain("Account holder: Ana Ruiz");
  });
});

describe("a line above a table's own header", () => {
  it("stays out of the table when the header lines up with the rows", async () => {
    const result = await convert(fixtureDocument([
      text(40, "Monthly statement for the customer account."),
      row(80, ["Account 1234", 40], ["Statement period", 170], ["Page 1 of 2", 390]),
      row(100, ["Date", 40], ["Description", 150], ["Amount", 400]),
      row(120, ["01/02", 40], ["Coffee", 150], ["12.50", 400]),
      row(140, ["03/02", 40], ["Rent", 150], ["900.00", 400]),
      row(160, ["05/02", 40], ["Fuel", 150], ["45.10", 400]),
    ]));
    expect(tables(result)[0]?.rows[0]).toEqual(["Date", "Description", "Amount"]);
    expect(texts(result)).toContain("Account 1234 Statement period Page 1 of 2");
  });

  it("stays out of a block of key-value lines when it does not read as a header", async () => {
    const result = await convert(fixtureDocument([
      row(75, ["123 Market Street", 40], ["Invoice no: INV-6201", 417]),
      row(89, ["San Francisco, CA 94111", 40], ["Date: 07/17/2024", 388]),
      row(103, ["VAT: ES336566881", 40], ["Due: 09/13/2024", 388]),
      text(140, "Thank you for your business."),
    ]));
    expect(tables(result)).toHaveLength(0);
  });

  it("stays out of the table when set in a title's size", async () => {
    const result = await convert(withSizes(fixtureDocument([
      boldRow(45, ["INVOICE", 40], ["Globex Ltd.", 480]),
      row(75, ["768 Market Street", 40], ["Invoice no: INV-6265", 417]),
      row(89, ["San Francisco, CA 94038", 40], ["Date: 16/03/2023", 413]),
      row(103, ["VAT: ES194832882", 40], ["Due: 16/03/2024", 386]),
    ]), new Map([[45, 18]])));
    expect(tables(result)).toHaveLength(0);
  });
});

describe("a continuation line", () => {
  for (const marker of [" – continued", ", continued", " (continued from page 1)", " (cont'd.)", "（続き）", " (Fortsetzung)", " (suite)"]) {
    it(`joins the table under its title followed by "${marker.trim()}"`, async () => {
      const result = await convert(fixtureDocument(
        [text(600, "Quarterly totals"), row(620, ["Item", 40], ["Amount", 200]), row(640, ["Alpha", 40], ["10", 200]), row(660, ["Beta", 40], ["20", 200])],
        [text(100, `Quarterly totals${marker}`), row(120, ["Gamma", 40], ["30", 200]), row(140, ["Delta", 40], ["40", 200])],
      ));
      expect(tables(result)).toHaveLength(1);
      expect(tables(result)[0]?.rows.at(-1)).toEqual(["Delta", "40"]);
    });
  }
});

describe("a bare continuation line", () => {
  for (const marker of ["Continued", "Продолжение", "(Fortsetzung)"]) {
    it(`joins the table under "${marker}" at the top of the next page`, async () => {
      const result = await convert(fixtureDocument(
        [text(600, "Staff by site"), row(620, ["Site", 40], ["Office", 200]), row(640, ["Alpha", 40], ["North", 200]), row(660, ["Beta", 40], ["South", 200])],
        [text(100, marker), row(120, ["Gamma", 40], ["East", 200]), row(140, ["Delta", 40], ["West", 200])],
      ));
      expect(tables(result)).toHaveLength(1);
      expect(tables(result)[0]?.rows.at(-1)).toEqual(["Delta", "West"]);
    });
  }
});

describe("narrow columns of prose", () => {
  const english = (end: string) => fixtureDocument([
    row(100, ["We took the night train from", 40], ["Later we all went", 300]),
    row(114, ["Paris and then a slow bus on", 40], ["to a small cafe and", 300]),
    row(128, [`to the old hotel near ${end}.`, 40], ["then back home.", 300]),
  ]);
  const german = (end: string) => fixtureDocument([
    row(100, ["Am Montag fuhren wir mit dem", 40], ["Danach gingen wir", 300]),
    row(114, ["Zug nach Berlin und dann zum", 40], ["alle ins Kino und", 300]),
    row(128, [`kleinen Hotel am Rand vom ${end}.`, 40], ["dann nach Hause.", 300]),
  ]);

  for (const [name, loaded] of [["Rome", english("Rome")], ["Venice", english("Venice")], ["Ort", german("Ort")], ["Dorfe", german("Dorfe")]] as const) {
    it(`stay prose when a sentence ends in "${name}."`, async () => {
      expect(tables(await convert(loaded))).toHaveLength(0);
    });
  }
});

describe("a note under the last row", () => {
  it("stays out of that row", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Item", 40], ["Qty", 200], ["Price", 300]),
      row(120, ["Alpha", 40], ["1", 200], ["10", 300]),
      row(140, ["Beta", 40], ["2", 200], ["20", 300]),
      row(160, ["Gamma", 40], ["3", 200], ["30", 300]),
      row(172, ["see note", 40], ["*", 200]),
    ]));
    expect(tables(result)[0]?.rows).toContainEqual(["Gamma", "3", "30"]);
  });
});

describe("brackets in cells", () => {
  it("keeps interval notation and corner quotes", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Range", 40], ["Label", 200], ["Share", 300]),
      row(120, ["[0, 10)", 40], ["「100」", 200], ["12", 300]),
      row(140, ["[10, 20]", 40], ["「2023年」", 200], ["13", 300]),
      row(160, ["(20, 30]", 40], ["none", 200], ["14", 300]),
    ]));
    expect(tables(result)[0]?.rows.slice(1).map((cells) => cells.slice(0, 2))).toEqual([
      ["[0, 10)", "「100」"],
      ["[10, 20]", "「2023年」"],
      ["(20, 30]", "none"],
    ]);
  });
});

describe("lines under or beside a table's rows", () => {
  const body = [
    row(100, ["Item", 40], ["Jan", 300], ["Feb", 360], ["Mar", 420]),
    row(115, ["Alpha", 40], ["1.2", 300], ["2.1", 360], ["2.6", 420]),
    row(130, ["Beta", 40], ["1.5", 300], ["3.0", 360], ["2.3", 420]),
    row(145, ["Gamma", 40], ["1.2", 300], ["2.8", 360], ["2.5", 420]),
  ];

  it("keeps a footnote whose text runs across several columns out of the table", async () => {
    const result = await convert(fixtureDocument([...body, row(157, ["Note 2", 40], ["Seasonal adjustment uses the census method.", 210])]));
    expect(tables(result)[0]?.rows.flat().join(" ")).not.toContain("Seasonal");
    expect(texts(result).join("\n")).toContain("Seasonal adjustment uses the census method.");
  });

  it("does not add a column for text far outside the table", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Item", 300], ["Jan", 400], ["Feb", 460], ["Mar", 520]),
      row(115, ["Alpha", 300], ["1.2", 400], ["2.1", 460], ["2.6", 520]),
      row(130, ["growth slowed and", 40], ["Beta", 300], ["1.5", 400], ["3.0", 460], ["2.3", 520]),
      row(145, ["Gamma", 300], ["1.2", 400], ["2.8", 460], ["2.5", 520]),
    ]));
    expect(tables(result).flatMap((table) => table.rows.flat())).not.toContain("growth slowed and");
  });

  it("gives each value line between the two lines of its label to that label", async () => {
    const result = await convert(fixtureDocument([
      row(100, ["Index", 40], ["Weight", 280], ["Nov", 340], ["Dec", 400]),
      row(115, ["General index", 40], ["1.000", 280], ["+0,2", 340], ["+0,1", 400]),
      row(130, ["Index excluding energy and fresh", 40]),
      row(135, ["826.256", 280], ["+0,2", 340], ["+0,2", 400]),
      row(140, ["food (core inflation)", 40]),
      row(154, ["Index excluding energy, food and", 40]),
      row(159, ["691.637", 280], ["+0,2", 340], ["+0,2", 400]),
      row(164, ["tobacco", 40]),
      row(178, ["Index excluding energy", 40], ["893.039", 280], ["+0,2", 340], ["+0,1", 400]),
    ]));
    const rows = tables(result).flatMap((table) => table.rows);
    const core = rows.find((cells) => cells.includes("826.256"));
    expect(core?.[0] ?? "").not.toContain("tobacco");
    expect(rows.find((cells) => cells.includes("691.637"))?.[0] ?? "").not.toContain("core inflation");
  });
});

describe("rows after a wrapped row", () => {
  it("stay rows of their own when wrapped rows stretch the step between row tops", async () => {
    const lines = [boldRow(100, ["Name", 40], ["Team", 160], ["Note", 300])];
    let y = 118;
    for (const [name, team, note, wrap] of [
      ["Ana Ruiz", "Sales", "North region"],
      ["Ben Ode", "Legal", "Contracts"],
      ["Cy Lam", "Sales", "Covers the southern region", "and the islands"],
      ["Di Park", "Support", "Leads the weekend on-call", "rotation"],
      ["Ed Fox", "Finance", "Runs payroll for all staff", "and contractors"],
      ["Flo Kim", "Finance", ""],
      ["Gus Lee", "Support", "Escalations"],
      ["Hal Ito", "Legal", "Compliance"],
    ] as const) {
      lines.push(note === "" ? row(y, [name, 40], [team, 160]) : row(y, [name, 40], [team, 160], [note, 300]));
      if (wrap === undefined) y += 18;
      else {
        lines.push(row(y + 11, [wrap, 300]));
        y += 30;
      }
    }
    const result = await convert(fixtureDocument(lines));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows).toContainEqual(["Cy Lam", "Sales", "Covers the southern region and the islands"]);
    expect(tables(result)[0]?.rows.slice(-3)).toEqual([["Flo Kim", "Finance", ""], ["Gus Lee", "Support", "Escalations"], ["Hal Ito", "Legal", "Compliance"]]);
  });

  it("does not join two full rows set closer than the rest", async () => {
    const result = await convert(fixtureDocument([
      boldRow(100, ["Name", 40], ["City", 200], ["Role", 360]),
      row(120, ["Alice Smith", 40], ["Paris", 200], ["Engineer", 360]),
      row(140, ["Bob Jones", 40], ["London", 200], ["Designer", 360]),
      row(160, ["Carol White", 40], ["Berlin", 200]),
      row(180, ["Dan Brown", 40], ["Rome", 200], ["Manager", 360]),
      row(194, ["Eve Black", 40], ["Madrid", 200], ["Analyst", 360]),
      row(220, ["Frank Green", 40], ["Oslo", 200], ["Clerk", 360]),
      row(234, ["Grace Hall", 40], ["Vienna", 200], ["Director", 360]),
    ]));
    expect(tables(result)[0]?.rows).toContainEqual(["Dan Brown", "Rome", "Manager"]);
    expect(tables(result)[0]?.rows.at(-1)).toEqual(["Grace Hall", "Vienna", "Director"]);
  });

  it("keeps a sparse table whose descriptions wrap", async () => {
    const result = await convert(fixtureDocument([
      text(100, "Charges for the month are listed below with any credits applied."),
      row(130, ["Water", 40], ["215.01", 160], ["753.34", 256]),
      row(148, ["Power", 40], ["516.30", 160], ["343.04", 256]),
      row(166, ["Late fee", 40], ["36.05", 160]),
      row(177, ["for March", 40]),
      row(195, ["Gas", 40], ["188.17", 160], ["602.51", 256]),
      row(213, ["Repairs", 40], ["94.51", 160]),
      row(224, ["to the roof", 40]),
      row(242, ["Rent", 40], ["458.28", 160], ["208.41", 256]),
      text(300, "Please contact your branch with any questions about this report."),
    ]));
    expect(tables(result)[0]?.rows).toContainEqual(["Late fee for March", "36.05", ""]);
  });
});

describe("a line under a table with a cell beside its columns", () => {
  it("opens no column when it is set apart like a new section", async () => {
    const result = await convert(fixtureDocument([
      boldRow(100, ["Item", 40], ["Amount", 200]),
      row(120, ["Alpha", 40], ["10.00", 200]),
      row(140, ["Beta", 40], ["20.00", 200]),
      row(160, ["Gamma", 40], ["30.00", 200]),
      row(195, ["Signed: Ana Ruiz", 40], ["Date: 01/02/2020", 200], ["Page 1 of 2", 330]),
    ]));
    expect(tables(result)[0]?.rows.every((cells) => cells.length === 2)).toBe(true);
    expect(texts(result).join("\n")).toContain("Signed: Ana Ruiz");
  });
});

describe("monospaced prose read word by word", () => {
  it("stays prose where word spaces line up down the page", async () => {
    const words = [
      "men under own would much our then after did never only that last it",
      "from should while we even these she her our people been no be my could",
      "used two she get my our came first been or another when the much there",
      "when out who than it her three has only right as the well another even",
      "it through through like come their were may but is first against my",
      "down make still he we over way work his into too back another at years",
      "much see time through with its can same them little make well has many",
    ];
    const lines = words.map((value, index) => {
      let column = 0;
      return row(100 + index * 14, ...value.split(" ").map((word): readonly [string, number] => {
        const at = 40 + column * 6;
        column += word.length + 1;
        return [word, at];
      }));
    });
    const monospaced = fixtureDocument(lines);
    for (const page of monospaced.pages) {
      for (const block of page.blocks ?? []) {
        if (block.kind !== "text") continue;
        for (const line of block.lines) for (const span of line.spans) Object.assign(span, { width: span.text.length * 6, style: { fontSize: 10 } });
      }
    }
    expect(tables(await convert(monospaced))).toHaveLength(0);
  });
});

describe("a table continued on the next page", () => {
  const firstPage = (above: readonly string[]) => [
    ...above.map((value, index) => text(560 + index * 20, value)),
    row(640, ["Item", 40], ["Amount", 200]),
    row(660, ["Alpha", 40], ["10", 200]),
    row(680, ["Beta", 40], ["20", 200]),
  ];
  const nextRows = [row(100, ["Gamma", 40], ["30", 200]), row(120, ["Delta", 40], ["40", 200]), row(140, ["Epsilon", 40], ["50", 200])];

  for (const [above, marker] of [
    [["Table 3: Fees"], "Fees (continued)"],
    [["Fees and charges"], "Fees (cont.)"],
    [["Checking account transactions", "Account number 1234"], "Checking account transactions (continued)"],
    [["Table 2: Revenue"], "Lines discontinued"],
  ] as const) {
    it(`continues under "${marker}" after "${above.join(" / ")}"`, async () => {
      const result = await convert(fixtureDocument(firstPage(above), [text(40, marker), ...nextRows]));
      expect(tables(result)).toHaveLength(1);
      expect(tables(result)[0]?.rows.at(-1)).toEqual(["Epsilon", "50"]);
    });
  }

  it("leaves a note set close above the next page's rows out of them", async () => {
    const result = await convert(fixtureDocument(
      [row(640, ["Item", 40], ["Amount", 200]), row(660, ["Alpha", 40], ["10.00", 200]), row(680, ["Beta", 40], ["20.00", 200])],
      [text(100, "Amounts are in US dollars."), row(112, ["Gamma", 40], ["30.00", 200]), row(132, ["Delta", 40], ["40.00", 200]), row(152, ["Epsilon", 40], ["50.00", 200])],
    ));
    expect(tables(result).flatMap((table) => table.rows.flat()).join(" ")).not.toContain("Amounts are");
    expect(texts(result)).toContain("Amounts are in US dollars.");
  });

  it("leaves a bold title set close above the next page's rows out of them", async () => {
    const result = await convert(fixtureDocument(
      [text(560, "Intro text paragraph that is long enough."), row(640, ["Item", 40], ["Amount", 200]), row(660, ["Alpha", 40], ["10", 200]), row(680, ["Beta", 40], ["20", 200])],
      [boldRow(100, ["Section B Overview", 40]), row(114, ["Gamma", 40], ["30", 200]), row(134, ["Delta", 40], ["40", 200]), row(154, ["Eps", 40], ["50", 200])],
    ));
    expect(tables(result).flatMap((table) => table.rows.flat()).join(" ")).not.toContain("Section B");
    expect(texts(result)).toContain("Section B Overview");
  });

  it("reads a header set on two lines, and drops it where the next page repeats it", async () => {
    const header = (y: number) => [row(y, ["Item", 40], ["Unit", 200], ["Region", 330]), row(y + 10, ["name", 40], ["price", 200])];
    const result = await convert(fixtureDocument(
      [...header(600), row(625, ["Alpha", 40], ["10", 200], ["North", 330]), row(645, ["Beta", 40], ["20", 200], ["South", 330]), row(665, ["Gamma", 40], ["30", 200], ["East", 330])],
      [...header(60), row(85, ["Delta", 40], ["40", 200], ["West", 330]), row(105, ["Epsilon", 40], ["50", 200], ["North", 330])],
    ));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows[0]).toEqual(["Item name", "Unit price", "Region"]);
    expect(tables(result)[0]?.rows.slice(1)).toEqual([
      ["Alpha", "10", "North"], ["Beta", "20", "South"], ["Gamma", "30", "East"], ["Delta", "40", "West"], ["Epsilon", "50", "North"],
    ]);
  });

  it("follows a title continuation line that repeats at the top of every page", async () => {
    const next = (page: number) => [
      text(40, "STAFF (continued)"),
      row(60, [`Carol${page}`, 40], ["Manager", 200]), row(80, [`Dave${page}`, 40], ["Analyst", 200]),
      row(100, [`Eve${page}`, 40], ["Writer", 200]), row(120, [`Fay${page}`, 40], ["Tester", 200]),
    ];
    const result = await convert(fixtureDocument(
      [text(560, "Some intro paragraph text here."), text(620, "STAFF"), row(640, ["Name", 40], ["Role", 200]), row(660, ["Alice", 40], ["Engineer", 200]), row(680, ["Bob", 40], ["Designer", 200])],
      next(2), next(3), next(4),
    ));
    expect(tables(result)[0]?.rows).toContainEqual(["Fay2", "Tester"]);
  });

  it("keeps sparse rows on the next page apart when the first page sets its header apart", async () => {
    const result = await convert(fixtureDocument(
      [row(640, ["Code", 40], ["Region", 200], ["Notes", 360]), row(670, ["A1", 40], ["North", 200], ["Open", 360]), row(688, ["B2", 40], ["South", 200], ["Closed", 360])],
      [
        row(60, ["Code", 40], ["Region", 200], ["Notes", 360]),
        row(90, ["C3", 40], ["East", 200]),
        row(108, ["D4", 40], ["West", 200], ["Open", 360]),
        row(126, ["E5", 40], ["Central", 200]),
        row(144, ["F6", 40], ["Coast", 200], ["Closed", 360]),
      ],
    ));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows.slice(-4)).toEqual([["C3", "East", ""], ["D4", "West", "Open"], ["E5", "Central", ""], ["F6", "Coast", "Closed"]]);
  });

  it("keeps full rows on the next page apart when they are set tighter than on the first", async () => {
    const result = await convert(fixtureDocument(
      [row(640, ["Code", 40], ["Region", 200], ["Notes", 360]), row(658, ["A1", 40], ["North", 200], ["Open", 360]), row(676, ["B2", 40], ["South", 200], ["Closed", 360])],
      [
        row(60, ["Code", 40], ["Region", 200], ["Notes", 360]),
        row(78, ["C3", 40], ["East", 200], ["Open", 360]),
        row(91, ["D4", 40], ["West", 200], ["Open", 360]),
        row(104, ["E5", 40], ["Central", 200], ["Closed", 360]),
      ],
    ));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows.slice(-3)).toEqual([["C3", "East", "Open"], ["D4", "West", "Open"], ["E5", "Central", "Closed"]]);
  });

  it("keeps the rows on the next page apart when the first page sets its header apart", async () => {
    const result = await convert(fixtureDocument(
      [row(640, ["Code", 40], ["Region", 200], ["Notes", 360]), row(670, ["A1", 40], ["North", 200], ["Open", 360]), row(688, ["B2", 40], ["South", 200], ["Closed", 360])],
      [
        row(60, ["Code", 40], ["Region", 200], ["Notes", 360]),
        row(90, ["C3", 40], ["East", 200], ["Open", 360]),
        row(108, ["D4", 40], ["West", 200], ["Open", 360]),
        row(126, ["E5", 40], ["Central", 200], ["Closed", 360]),
      ],
    ));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows.slice(-3)).toEqual([["C3", "East", "Open"], ["D4", "West", "Open"], ["E5", "Central", "Closed"]]);
  });
});

describe("a running header that ends in a continuation mark", () => {
  for (const header of ["Notes to the consolidated financial statements (continued)", "Service bulletin: model X discontinued"]) {
    it(`stays a page header: "${header}"`, async () => {
      const page = (number: number) => [
        text(20, header),
        text(100, `Note ${number} describes the accounting policy that applies to leases and rentals.`),
        text(114, "The group measures each lease liability at the present value of payments."),
        text(770, `Page ${number}`),
      ];
      const result = await convert(fixtureDocument(page(1), page(2), page(3)));
      expect(result.pages[1]?.elements.find((element) => "text" in element && element.text === header)?.kind).toBe("page-header");
    });
  }
});

describe("headings on a page whose table is set larger than its notes", () => {
  it("stay headings", async () => {
    const items = [
      "Consulting services rendered", "Software licence renewal", "Hardware maintenance plan", "Travel and accommodation",
      "Training workshop seats", "Cloud hosting subscription", "Support retainer fee", "Data migration project",
    ].map((name, index) => row(200 + index * 18, [name, 40], [`${100 + index}.00`, 300], [`${1000 + index * 37}.50`, 420]));
    const loaded = fixtureDocument([
      text(100, "Quarterly invoice summary"),
      text(130, "Amounts are shown in US dollars."),
      row(180, ["Item", 40], ["Qty", 300], ["Total", 420]),
      ...items,
      text(400, "Payment terms"),
      text(430, "Payment is due within 30 days."),
    ]);
    const sizes = new Map([[100, 12.5], [130, 10], [400, 12.5], [430, 10]]);
    for (const page of loaded.pages) {
      for (const block of page.blocks ?? []) {
        if (block.kind !== "text") continue;
        for (const line of block.lines) for (const span of line.spans) Object.assign(span, { style: { fontSize: sizes.get(line.y) ?? 11 } });
      }
    }
    const markdown = (await new DocumentConverter().convert({ loaded }, { format: "markdown" })).content;
    expect(markdown).toMatch(/^#+ Quarterly invoice summary$/mu);
    expect(markdown).toMatch(/^#+ Payment terms$/mu);
  });
});

describe("a short item list over smaller totals", () => {
  it("keeps the totals in its table", async () => {
    const result = await convert(withSizes(fixtureDocument([
      row(198, ["Item", 40], ["Quantity", 312], ["Rate", 437], ["Total", 548]),
      row(215, ["Consulting services", 40], ["7", 345], ["3,174.50", 421], ["22,221.50", 531]),
      row(230, ["Setup fee", 40], ["1", 345], ["100.00", 431], ["100.00", 541]),
      row(250, ["Subtotal", 397], ["22,321.50", 541]),
      row(261, ["Tax (21%)", 397], ["2,222.15", 544]),
      row(272, ["Total Due", 397], ["24,543.65", 541]),
    ]), new Map([[198, 9], [215, 9], [230, 9], [250, 7], [261, 7], [272, 7]])));
    expect(tables(result)).toHaveLength(1);
    expect(tables(result)[0]?.rows[1]?.[0]).toBe("Consulting services");
    expect(tables(result)[0]?.rows.at(-1)?.filter((cell) => cell !== "")).toEqual(["Total Due", "24,543.65"]);
  });
});

