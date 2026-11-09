import { describe, expect, it } from "vitest";
import {
  DocumentConverter,
  DocumentLoaderData,
  type ConversionFormat,
  type LoadedDocument,
  type TextLine,
  type TextSpan,
} from "../../src/core/index.js";
import { inMemoryLoader } from "../../src/testing/doubles.js";

interface Line {
  readonly text: string;
  readonly y: number;
  readonly x?: number;
  readonly right?: number;
  readonly size?: number;
  readonly bold?: boolean;
  readonly monospace?: boolean;
  readonly fontFamily?: string;
  readonly cells?: readonly (readonly [string, number])[];
}

const MARGIN = 72;
const MEASURE = 540;

/** One text block per visual line, the way PDF.js and MuPDF return a text layer. */
function textLayer(lines: readonly Line[]): LoadedDocument {
  const textLines = lines.map((line): TextLine => {
    const size = line.size ?? 10;
    const style = {
      fontSize: size,
      ...(line.bold === true ? { bold: true } : {}),
      ...(line.monospace === true ? { monospace: true } : {}),
      ...(line.fontFamily === undefined ? {} : { fontFamily: line.fontFamily }),
    };
    const x = line.x ?? MARGIN;
    const spans: TextSpan[] = line.cells === undefined
      ? [{ text: line.text, x, y: line.y, width: (line.right ?? x + line.text.length * size * 0.5) - x, height: size, style }]
      : line.cells.map(([text, left]) => ({ text, x: left, y: line.y, width: text.length * size * 0.5, height: size, style }));
    return { y: line.y, height: size, text: spans.map((span) => span.text).join(" "), spans };
  });
  const text = textLines.map((line) => line.text).join("\n");
  return {
    loader: "text-layer-fixture",
    form: "digital",
    text,
    pages: [{
      pageNumber: 1,
      width: 612,
      height: 792,
      text,
      lines: textLines,
      blocks: textLines.map((line, index) => {
        const left = Math.min(...line.spans.map((span) => span.x));
        const right = Math.max(...line.spans.map((span) => span.x + span.width));
        return { id: `p1-text-${index + 1}`, kind: "text" as const, x: left, y: line.y, width: right - left, height: line.height, lines: [line] };
      }),
    }],
  };
}

async function convert(loaded: LoadedDocument, format: ConversionFormat = "markdown") {
  return new DocumentConverter().convert({ loaded }, { format });
}

describe("wrapped text-layer lines", () => {
  it("joins the wrapped lines of a paragraph into one paragraph", async () => {
    const result = await convert(textLayer([
      { text: "Commerce on the Internet has come to rely almost exclusively on", y: 100, right: MEASURE },
      { text: "financial institutions serving as trusted third parties to process", y: 112, right: MEASURE - 2 },
      { text: "electronic payments.", y: 124 },
    ]));

    expect(result.content).toBe(
      "<!-- page: 1 -->\n\nCommerce on the Internet has come to rely almost exclusively on\n" +
        "financial institutions serving as trusted third parties to process\nelectronic payments.",
    );
    const [paragraph] = result.pages[0]?.elements ?? [];
    expect(paragraph?.provenance.sourceIds).toEqual(["p1-text-1", "p1-text-2", "p1-text-3"]);
    expect(paragraph?.provenance.lineIds).toEqual(["p1-line-1", "p1-line-2", "p1-line-3"]);
  });

  it("keeps paragraphs apart at an indented first line, a short last line, and a wider gap", async () => {
    const result = await convert(textLayer([
      { text: "The first paragraph fills the whole measure on its first line and", y: 100, right: MEASURE },
      { text: "fills it again on its second line, which ends at the margin too.", y: 112, right: MEASURE },
      { text: "The second paragraph starts with an indent and fills the measure", y: 124, x: MARGIN + 15, right: MEASURE },
      { text: "before it ends short.", y: 136 },
      { text: "Further down, after a blank line of space, a third paragraph starts", y: 166, right: MEASURE },
      { text: "and ends here.", y: 178 },
    ]));

    expect(result.pages[0]?.elements.map((element) => [element.kind, "text" in element ? element.text : ""])).toEqual([
      ["paragraph", "The first paragraph fills the whole measure on its first line and\nfills it again on its second line, which ends at the margin too."],
      ["paragraph", "The second paragraph starts with an indent and fills the measure\nbefore it ends short."],
      ["paragraph", "Further down, after a blank line of space, a third paragraph starts\nand ends here."],
    ]);
  });

  it("keeps the lines of an address block apart when the page sets a wider measure", async () => {
    const result = await convert(textLayer([
      { text: "Example Traders Ltd", y: 100 },
      { text: "Unit 5, Specimen Estate", y: 112 },
      { text: "Payment is due within thirty days of the invoice date, by bank transfer.", y: 160, right: MEASURE },
    ]));

    expect(result.content).toBe(
      "<!-- page: 1 -->\n\nExample Traders Ltd\n\nUnit 5, Specimen Estate\n\n" +
        "Payment is due within thirty days of the invoice date, by bank transfer.",
    );
  });

  it("fences a monospace listing as one code block that keeps its indentation", async () => {
    const result = await convert(textLayer([
      { text: "int main(void)", y: 100, size: 8, monospace: true },
      { text: "{", y: 109, size: 8, monospace: true },
      { text: "return 0;", y: 118, x: MARGIN + 16, size: 8, monospace: true },
      { text: "}", y: 127, size: 8, monospace: true },
    ]));

    expect(result.content).toBe("<!-- page: 1 -->\n\n```\nint main(void)\n{\n    return 0;\n}\n```");
  });

  it("treats a Courier font as code when the loader reports it as proportional", async () => {
    const result = await convert(textLayer([
      { text: "#include <math.h>", y: 100, size: 8, fontFamily: "HAAAAA+CourierNewPSMT" },
      { text: "double p = 1.0 - q;", y: 109, size: 8, fontFamily: "HAAAAA+CourierNewPSMT" },
    ]));

    expect(result.content).toBe("<!-- page: 1 -->\n\n```\n#include <math.h>\ndouble p = 1.0 - q;\n```");
  });

  it("joins a title that wraps onto a second line into one heading", async () => {
    const result = await convert(textLayer([
      { text: "Assessment of Undiscovered Oil and Gas Resources in the", y: 60, size: 18, right: MEASURE },
      { text: "Norphlet Formation, 2023", y: 82, size: 18 },
      { text: "Using a geology-based assessment methodology, the survey estimated", y: 120, right: MEASURE },
      { text: "undiscovered resources.", y: 132 },
    ]));

    expect(result.content).toBe(
      "<!-- page: 1 -->\n\n# Assessment of Undiscovered Oil and Gas Resources in the Norphlet Formation, 2023\n\n" +
        "Using a geology-based assessment methodology, the survey estimated\nundiscovered resources.",
    );
  });

  it("keeps a wrapped line of a list item in that item", async () => {
    const result = await convert(textLayer([
      { text: "5) Nodes accept the block only if all transactions in it are valid.", y: 100, x: 87 },
      { text: "6) Nodes express their acceptance of the block by working on the next block in the", y: 112, x: 87, right: MEASURE },
      { text: "chain, using the hash of the accepted block as the previous hash.", y: 124, x: 105 },
    ]));

    expect(result.content).toBe(
      "<!-- page: 1 -->\n\n5) Nodes accept the block only if all transactions in it are valid.\n" +
        "6) Nodes express their acceptance of the block by working on the next block in the\n" +
        "chain, using the hash of the accepted block as the previous hash.",
    );
  });
});

describe("heading size reference", () => {
  const diagramLabels = ["Owner 1's", "Owner 2's", "Public Key", "Hash", "Hash", "Verify", "Signature", "Sign", "Sign", "Private Key"]
    .map((text, index): Line => ({ text, y: 200 + index * 12, x: 250, size: 7 }));

  it("measures headings against the size of most characters rather than most spans", async () => {
    const result = await convert(textLayer([
      { text: "2. Transactions", y: 82, size: 11.5 },
      { text: "We define an electronic coin as a chain of digital signatures. Each", y: 100, right: MEASURE },
      { text: "owner transfers the coin to the next by signing a hash.", y: 112 },
      ...diagramLabels,
      { text: "The problem of course is the payee cannot verify that one of the", y: 340, right: MEASURE },
      { text: "owners did not double-spend the coin.", y: 352 },
    ]));

    expect(result.content).toBe(
      "<!-- page: 1 -->\n\n# 2\\. Transactions\n\n" +
        "We define an electronic coin as a chain of digital signatures. Each\nowner transfers the coin to the next by signing a hash.\n\n" +
        "Owner 1's\n\nOwner 2's\n\nPublic Key\n\nHash\n\nHash\n\nVerify\n\nSignature\n\nSign\n\nSign\n\nPrivate Key\n\n" +
        "The problem of course is the payee cannot verify that one of the\nowners did not double-spend the coin.",
    );
  });

  it("keeps a lead paragraph above a small-print table as body text", async () => {
    const rows = Array.from({ length: 8 }, (_unused, index): Line => ({
      text: "",
      y: 200 + index * 11,
      size: 9,
      cells: [[`Industry group ${index + 1}`, MARGIN], [`${100 + index}.4`, 300], [`${90 + index}.7`, 380], [`${80 + index}.2`, 460]],
    }));
    const result = await convert(textLayer([
      { text: "Industrial production increased 0.7 percent in September after edging up", y: 100, size: 12, right: MEASURE },
      { text: "in August.", y: 115, size: 12 },
      ...rows,
    ]));

    expect(result.pages[0]?.elements.map((element) => element.kind)).toEqual(["paragraph", "table"]);
  });
});

describe("ordered list numbers", () => {
  const steps = textLayer([
    { text: "3. Collect new transactions into a block.", y: 100 },
    { text: "4. Find a proof-of-work for the block.", y: 112 },
  ]);

  it("keeps each item's own number and delimiter in Markdown", async () => {
    const result = await convert(steps);
    expect(result.content).toBe("<!-- page: 1 -->\n\n3. Collect new transactions into a block.\n4. Find a proof-of-work for the block.");
  });

  it("starts the HTML list at the first item's number", async () => {
    const result = await convert(steps, "html");
    expect(result.content).toContain(
      '<ol start="3">\n<li>Collect new transactions into a block.</li>\n<li>Find a proof-of-work for the block.</li>\n</ol>',
    );
  });
});

describe("Markdown line-start escaping", () => {
  it.each([
    ["a hash with no space after it", "#include <stdio.h> // see #42", "\\#include \\<stdio.h\\> // see #42"],
    ["an equals underline", "Total\n===", "Total\n\\==="],
    ["a lone dash under a line", "Item\n-", "Item\n\\-"],
    ["a number and period ending a line", "Chapter\n12.", "Chapter\n12\\."],
  ])("escapes %s on any line of a paragraph", async (_case, source, markdown) => {
    const result = await new DocumentConverter().loadDocumentLoader(new DocumentLoaderData()).convert({
      bytes: new TextEncoder().encode(source),
      mimeType: "text/plain",
    });
    expect(result.content).toBe(`<!-- page: 1 -->\n\n${markdown}`);
  });
});

describe("Markdown table cells", () => {
  it("leaves dashes, hashes, and numbers at the start of a cell unescaped", async () => {
    const document: LoadedDocument = {
      text: "Line Change\n# 1 -\n2. +",
      form: "digital",
      loader: "native-table",
      pages: [{
        pageNumber: 1,
        width: 612,
        height: 792,
        text: "Line Change\n# 1 -\n2. +",
        layout: [{
          id: "t1",
          kind: "table",
          rows: [["Line", "Change"], ["# 1", "-"], ["2.", "+"]],
          headerRows: 1,
          provenance: { pageNumber: 1, box: { x: 72, y: 100, width: 200, height: 36 }, sourceIds: ["t1"] },
        }],
      }],
    };
    const result = await new DocumentConverter({ loaders: [inMemoryLoader(document)] }).convert({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    expect(result.content).toBe("<!-- page: 1 -->\n\n| Line | Change |\n| --- | --- |\n| # 1 | - |\n| 2. | + |");
  });
});
