import { describe, expect, it } from "vitest";
import { DocumentConverter, type LoadedDocument, type TextLine, type TextSpan, type TextStyle } from "../../src/core/index.js";

type Run = readonly [text: string, style?: TextStyle & { readonly x?: number; readonly width?: number }];

interface Row {
  readonly y: number;
  readonly x?: number;
  readonly size?: number;
  readonly runs: readonly Run[];
}

/**
 * One block per visual line with one span per font run, the way PDF.js returns
 * a text layer. A run without an `x` starts where the previous run ends.
 */
function textLayer(rows: readonly Row[], width = 612): LoadedDocument {
  const lines = rows.map((row): TextLine => {
    const size = row.size ?? 10;
    let cursor = row.x ?? 72;
    const spans = row.runs.map(([text, style = {}]): TextSpan => {
      const { x = cursor, width = text.length * size * 0.5, ...rest } = style;
      const span = { text, x, y: row.y, width, height: size, style: { fontSize: size, ...rest } };
      cursor = x + span.width;
      return span;
    });
    return { y: row.y, height: size, text: spans.map((span) => span.text).join(""), spans };
  });
  const text = lines.map((line) => line.text).join("\n");
  return {
    loader: "text-layer-fixture",
    form: "digital",
    text,
    pages: [{
      pageNumber: 1,
      width,
      height: 792,
      text,
      lines,
      blocks: lines.map((line, index) => {
        const left = Math.min(...line.spans.map((span) => span.x));
        const right = Math.max(...line.spans.map((span) => span.x + span.width));
        return { id: `p1-text-${index + 1}`, kind: "text" as const, x: left, y: line.y, width: right - left, height: line.height, lines: [line] };
      }),
    }],
  };
}

/** `loaded` with one more text block: a run set up the left margin, reading bottom to top. */
function withMarginStamp(loaded: LoadedDocument, text: string): LoadedDocument {
  const [page] = loaded.pages;
  if (page === undefined) return loaded;
  const span: TextSpan = { text, x: 12, y: 90, width: 20, height: 364, rotation: 90, style: { fontSize: 20 } };
  const line: TextLine = { y: span.y, height: span.height, text, spans: [span] };
  const block = { id: "p1-stamp", kind: "text" as const, x: span.x, y: span.y, width: span.width, height: span.height, lines: [line] };
  return { ...loaded, pages: [{ ...page, lines: [...(page.lines ?? []), line], blocks: [block, ...(page.blocks ?? [])] }] };
}

async function markdown(loaded: LoadedDocument): Promise<string> {
  return (await new DocumentConverter().convert({ loaded }, { format: "markdown" })).content;
}

describe("bold and monospace runs inside running text", () => {
  it("keeps a bold run-in lead inside the paragraph it opens", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Future developments", { bold: true }], [". For the latest information about developments"]] },
      { y: 112, runs: [["related to Form W-9 and its instructions, such as legislation enacted"]] },
      { y: 124, runs: [["after they were published, go to www.irs.gov/FormW9."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nFuture developments. For the latest information about developments\n" +
        "related to Form W-9 and its instructions, such as legislation enacted\n" +
        "after they were published, go to www.irs.gov/FormW9.",
    );
  });

  it("keeps a bold lead-in that wraps onto a second line inside its paragraph", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Establishing U.S. status for purposes of chapter 3 and chapter 4", { bold: true }]] },
      { y: 112, runs: [["withholding.", { bold: true }], [" Payments made to foreign persons, including certain"]] },
      { y: 124, runs: [["types of income, are subject to withholding."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nEstablishing U.S. status for purposes of chapter 3 and chapter 4\n" +
        "withholding. Payments made to foreign persons, including certain\n" +
        "types of income, are subject to withholding.",
    );
  });

  it("does not promote a short line that is only partly bold to a heading", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Coverage.", { bold: true }], [" The index measures", { x: 117 }]] },
      { y: 140, runs: [["The body of the page continues in regular type for several more words."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nCoverage. The index measures\n\n" +
        "The body of the page continues in regular type for several more words.",
    );
  });

  it("keeps the wrapped tail of a monospace URL in its paragraph", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Ben Hayes is supported by UK Research and Innovation grant num-"]] },
      { y: 112, runs: [["ber EP/S022694/1. This research utilised the HPC facility at"]] },
      { y: 124, runs: [["Queen Mary, supported by Research-IT. ", { x: 72 }], ["http://doi.org/1", { monospace: true }]] },
      { y: 136, runs: [["zenodo.438045", { monospace: true }]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nBen Hayes is supported by UK Research and Innovation grant num-\n" +
        "ber EP/S022694/1. This research utilised the HPC facility at\n" +
        "Queen Mary, supported by Research-IT. http://doi.org/1\nzenodo.438045",
    );
  });

  it("still reads a short all-bold line as a heading", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Manufacturing (SIC)", { bold: true }]] },
      { y: 140, runs: [["The body of the page continues in regular type for several more words."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\n# Manufacturing (SIC)\n\n" +
        "The body of the page continues in regular type for several more words.",
    );
  });

  it("keeps bold table rows, amounts, and rules out of the outline", async () => {
    const body = { y: 300, runs: [["The body of the page continues in regular type for several more words."]] } as const;
    const content = await markdown(textLayer([
      { y: 100, runs: [["Date", { bold: true }], ["Description", { bold: true, x: 140 }], ["Balance", { bold: true, x: 400 }]] },
      { y: 140, runs: [["Previous balance 06/28/2019 $3,005.93", { bold: true }]] },
      { y: 180, runs: [["Total Interest For This Period: 14.09", { bold: true }]] },
      { y: 220, runs: [["Total due ₹17,348.36", { bold: true }]] },
      { y: 260, runs: [["_____________", { bold: true }]] },
      body,
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nDate Description Balance\n\nPrevious balance 06/28/2019 $3,005.93\n\n" +
        "Total Interest For This Period: 14.09\n\nTotal due ₹17,348.36\n\n\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\n\n" +
        "The body of the page continues in regular type for several more words.",
    );
  });

  it("reads a bold version or appendix number as a heading", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Version 3.11", { bold: true }]] },
      { y: 130, runs: [["This release fixes several crashes in the importer and improves speed."]] },
      { y: 170, runs: [["Appendix 4.10", { bold: true }]] },
      { y: 200, runs: [["The appendix lists every option the command line accepts in this release."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\n# Version 3.11\n\nThis release fixes several crashes in the importer and improves speed.\n\n" +
        "# Appendix 4.10\n\nThe appendix lists every option the command line accepts in this release.",
    );
  });

  it("keeps a bold amount without a currency sign out of the outline", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["Amount due 1,204.50", { bold: true }]] },
      { y: 140, runs: [["Balance carried forward: 980.00", { bold: true }]] },
      { y: 180, runs: [["The body of the page continues in regular type for several more words."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nAmount due 1,204.50\n\nBalance carried forward: 980.00\n\n" +
        "The body of the page continues in regular type for several more words.",
    );
  });

  it("keeps a large line without letters, such as an equation, out of the outline", async () => {
    const content = await markdown(textLayer([
      { y: 100, runs: [["The probability is the sum over every amount of progress he could make."]] },
      { y: 130, size: 16, runs: [["∑ ⋅"]] },
      { y: 170, runs: [["Rearranging avoids summing the infinite tail of the distribution."]] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nThe probability is the sum over every amount of progress he could make.\n\n∑ ⋅\n\n" +
        "Rearranging avoids summing the infinite tail of the distribution.",
    );
  });
});

describe("rotated margin text", () => {
  it("keeps a rotated stamp out of the outline and out of the paragraph it crosses", async () => {
    const content = await markdown(withMarginStamp(textLayer([
      { y: 80, size: 14, runs: [["Sinusoidal Frequency Estimation"]] },
      { y: 100, runs: [["Sinusoidal parameter estimation is a fundamental task in appli-"]] },
      { y: 112, runs: [["cations from spectral analysis to time-series forecasting, and is"]] },
      { y: 124, runs: [["often impossible by gradient descent."]] },
    ]), "arXiv:2210.14476v2 [eess.SP] 18 Nov 2022"));

    expect(content).toBe(
      "<!-- page: 1 -->\n\n# Sinusoidal Frequency Estimation\n\n" +
        "Sinusoidal parameter estimation is a fundamental task in appli-\n" +
        "cations from spectral analysis to time-series forecasting, and is\n" +
        "often impossible by gradient descent.\n\n" +
        "arXiv:2210.14476v2 \\[eess.SP\\] 18 Nov 2022",
    );
  });
});

describe("two columns of prose", () => {
  it("reads two prose columns set one span per word as paragraphs", async () => {
    const words = (text: string, x: number) => text.split(" ").map((word, index, all): Run => {
      const before = all.slice(0, index).join(" ");
      return [word, { x: x + (before.length + (index > 0 ? 1 : 0)) * 5 }];
    });
    const content = await markdown(textLayer([
      { y: 100, runs: [...words("The committee met on Monday to review", 50), ...words("Several proposals concerned the park", 316)] },
      { y: 113, runs: [...words("proposals submitted by members of the", 50), ...words("and the new cycle lanes on the road", 316)] },
      { y: 126, runs: [...words("public during the consultation and", 50), ...words("that residents have requested for", 316)] },
      { y: 139, runs: [...words("agreed to publish the results.", 50), ...words("years without any success.", 316)] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\nThe committee met on Monday to review\nproposals submitted by members of the\n" +
        "public during the consultation and\nagreed to publish the results.\n\n" +
        "Several proposals concerned the park\nand the new cycle lanes on the road\n" +
        "that residents have requested for\nyears without any success.",
    );
  });

  it("reads justified columns of Chinese prose as paragraphs, not table rows", async () => {
    const left = (text: string, width = 252) => [text, { x: 46, width }] as const;
    const right = (text: string, width = 252) => [text, { x: 316, width }] as const;
    const content = await markdown(textLayer([
      { y: 365, size: 9, runs: [left("纳税人有权只缴纳合法的应纳税款，包括利息和罚金，并有权要"), right("有纳税人或法律授权的除外。纳税人有权对错误使用或泄露纳税")] },
      { y: 375, size: 9, runs: [left("求 IRS 正确使用所付税款。", 109), right("人申报信息的员工、申报经办人或其他人员采取适当行动。", 234)] },
      { y: 395, size: 9, runs: [left("纳税人有权要求他们提供给 IRS 的任何信息不得向外泄露，但"), right("纳税人有权在独立论坛对大多数 IRS 的决定提出上诉，包括")] },
      { y: 405, size: 9, runs: [left("有纳税人或法律授权的除外。纳税人有权对错误使用或泄露纳税"), right("多种处罚，并有权得到申诉办公室决策的书面答复。纳税人有权")] },
      { y: 415, size: 9, runs: [left("人申报信息的员工采取适当行动。", 135), right("将他们的案件提交至法院。", 108)] },
    ]));

    expect(content).toBe(
      "<!-- page: 1 -->\n\n纳税人有权只缴纳合法的应纳税款，包括利息和罚金，并有权要\n求 IRS 正确使用所付税款。\n\n" +
        "纳税人有权要求他们提供给 IRS 的任何信息不得向外泄露，但\n有纳税人或法律授权的除外。纳税人有权对错误使用或泄露纳税\n人申报信息的员工采取适当行动。\n\n" +
        "有纳税人或法律授权的除外。纳税人有权对错误使用或泄露纳税\n人申报信息的员工、申报经办人或其他人员采取适当行动。\n\n" +
        "纳税人有权在独立论坛对大多数 IRS 的决定提出上诉，包括\n多种处罚，并有权得到申诉办公室决策的书面答复。纳税人有权\n将他们的案件提交至法院。",
    );
  });
});
