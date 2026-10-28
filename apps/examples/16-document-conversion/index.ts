/**
 * Grounded PDF conversion without a schema or model.
 *
 *     pnpm --filter @docture/examples convert
 *
 * Needs: nothing. The PDF is generated deterministically in memory.
 */

import { DocumentConverter, parseDoctureDocument, provenanceSegments, type LoadedPage } from "docture";
import { chunkDocument } from "docture/chunk";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { makeRichDocumentPdf } from "docture/testing/fixtures";
import { field, heading, note, step } from "../shared/print.js";
import { isMain, run } from "../shared/run.js";

function reportPage(pageNumber: number): LoadedPage {
  const lines = [
    [20, "ACME Corp Confidential"],
    [100, `Findings for section ${pageNumber}.`],
    [780, `Page ${pageNumber} of 3`],
  ].map(([y, text]) => ({
    y: Number(y), height: 12, text: String(text),
    spans: [{ text: String(text), x: 40, y: Number(y), width: String(text).length * 5, height: 12 }],
  }));
  return {
    pageNumber, width: 600, height: 800,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    blocks: lines.map((line, index) => ({
      id: `p${pageNumber}-text-${index + 1}`, kind: "text" as const,
      x: 40, y: line.y, width: line.text.length * 5, height: 12, lines: [line],
    })),
  };
}

/** Running headers and footers stay out of Markdown and remain in saved JSON. */
export async function convertRunningHeaders() {
  const pages = [1, 2, 3].map(reportPage);
  const loaded = {
    loader: "in-memory", form: "digital" as const,
    text: pages.map((page) => page.text).join("\f"), pages,
  };
  const converter = new DocumentConverter();
  const markdown = await converter.convert({ loaded }, { format: "markdown" });
  const json = await converter.convert({ loaded }, { format: "json" });
  const saved = parseDoctureDocument(JSON.parse(json.content));
  if (!saved.ok) throw new Error(saved.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  const footers = saved.document.pages.flatMap((page) =>
    page.elements.flatMap((element) => (element.kind === "page-footer" ? [element.text] : [])));
  return { markdown: markdown.content, footers, sourceVersion: saved.sourceVersion };
}

/** A group label over two columns: one merged cell in HTML, flattened labels in Markdown. */
export async function convertGroupHeaderTable() {
  const rows = [
    [100, [["Item", 40], ["Quarters", 200]]],
    [120, [["Q1", 200], ["Q2", 230]]],
    [140, [["Alpha", 40], ["10", 200], ["20", 230]]],
    [160, [["Beta", 40], ["30", 200], ["40", 230]]],
  ] as const;
  const lines = rows.map(([y, cells]) => ({
    y, height: 12, text: cells.map(([text]) => text).join(" "),
    spans: cells.map(([text, x]) => ({ text, x, y, width: Math.max(10, text.length * 5), height: 12 })),
  }));
  const page: LoadedPage = {
    pageNumber: 1, width: 600, height: 800,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    blocks: lines.map((line, index) => {
      const x = line.spans[0]?.x ?? 0;
      const last = line.spans[line.spans.length - 1];
      return {
        id: `p1-text-${index + 1}`, kind: "text" as const,
        x, y: line.y, width: (last === undefined ? 0 : last.x + last.width) - x, height: 12, lines: [line],
      };
    }),
  };
  const loaded = { loader: "in-memory", form: "digital" as const, text: page.text, pages: [page] };
  const converter = new DocumentConverter();
  const html = await converter.convert({ loaded }, { format: "html" });
  const markdown = await converter.convert({ loaded }, { format: "markdown" });
  const table = html.pages[0]?.elements.find((element) => element.kind === "table");
  return {
    headerRows: table?.kind === "table" ? table.headerRows : 0,
    spans: table?.kind === "table" ? table.spans ?? [] : [],
    html: /<table>.*<\/table>/u.exec(html.content)?.[0] ?? "",
    markdownHeader: markdown.content.split("\n").find((line) => line.startsWith("|")) ?? "",
  };
}

function tablePage(pageNumber: number, rows: readonly (readonly [number, string, string])[]): LoadedPage {
  const lines = rows.map(([y, item, amount]) => ({
    y, height: 12, text: `${item} ${amount}`,
    spans: [
      { text: item, x: 40, y, width: item.length * 5, height: 12 },
      { text: amount, x: 200, y, width: Math.max(10, amount.length * 5), height: 12 },
    ],
  }));
  return {
    pageNumber, width: 600, height: 800,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    blocks: lines.map((line, index) => ({
      id: `p${pageNumber}-text-${index + 1}`, kind: "text" as const,
      x: 40, y: line.y, width: 170, height: 12, lines: [line],
    })),
  };
}

/** A table that runs over a page break becomes one table on the page where it starts. */
export async function convertContinuedTable() {
  const pages = [
    tablePage(1, [[640, "Item", "Amount"], [660, "Alpha", "10"], [680, "Beta", "20"]]),
    tablePage(2, [[100, "Gamma", "30"], [120, "Delta", "40"], [140, "Epsilon", "50"]]),
  ];
  const loaded = { loader: "in-memory", form: "digital" as const, text: pages.map((page) => page.text).join("\f"), pages };
  const converter = new DocumentConverter();
  const json = await converter.convert({ loaded }, { format: "json" });
  const markdown = await converter.convert({ loaded }, { format: "markdown" });
  const table = json.pages[0]?.elements.find((element) => element.kind === "table");
  if (table?.kind !== "table") throw new Error("expected one table on page 1");
  return {
    rows: table.rows,
    pages: provenanceSegments(table.provenance).map((segment) => segment.pageNumber),
    rowPages: table.rowProvenance?.map((segment) => segment.pageNumber) ?? [],
    markdown: markdown.content,
  };
}

/** Retrieval chunks of the continued table: each piece repeats the header and cites its own rows' page. */
export async function chunkContinuedTable() {
  const pages = [
    tablePage(1, [[640, "Item", "Amount"], [660, "Alpha", "10"], [680, "Beta", "20"]]),
    tablePage(2, [[100, "Gamma", "30"], [120, "Delta", "40"], [140, "Epsilon", "50"]]),
  ];
  const loaded = { loader: "in-memory", form: "digital" as const, text: pages.map((page) => page.text).join("\f"), pages };
  const result = await new DocumentConverter().convert({ loaded }, { format: "json" });
  return chunkDocument(result, { budget: { unit: "characters", max: 61 } }).map((chunk) => ({
    text: chunk.text,
    pages: chunk.provenance.map((segment) => segment.pageNumber),
  }));
}

export async function convertRichFixture() {
  const fixture = await makeRichDocumentPdf();
  await using converter = new DocumentConverter()
    .loadDocumentLoader(new DocumentLoaderPdfJs());
  return await converter.convert(
      {
        bytes: fixture.bytes,
        mimeType: "application/pdf",
        fileName: "rich-document.pdf",
      },
      { format: "markdown", assets: "referenced" },
  );
}

export async function convertSelectedPage() {
  const fixture = await makeRichDocumentPdf();
  await using converter = new DocumentConverter()
    .loadDocumentLoader(new DocumentLoaderPdfJs());
  const result = await converter.convert(
    { bytes: fixture.bytes, mimeType: "application/pdf", fileName: "rich-document.pdf" },
    { format: "markdown", assets: "omit", pages: [2] },
  );
  return { pages: result.pages.map((page) => page.pageNumber), markdown: result.content };
}

async function main(): Promise<void> {
  heading("Document conversion");
  step("1. generate a real layout-rich PDF in memory");
  note(
    "The fixture has two pages, typography, two columns, a list, table, link, code, " +
      "and an embedded image. No schema or model is involved.",
  );

  step("2. convert it to grounded Markdown");
  const result = await convertRichFixture();
  field("loader", result.loader);
  field("method", result.method);
  field("pages", result.pages.length);
  field("assets", result.assets.map((asset) => asset.reference).join(", "));
  field("warnings", result.warnings.length);

  console.log("\n" + result.content);
  console.log("\nThe library returned strings and Uint8Array assets. It wrote no files.");

  step("3. leave running headers and footers out of the body");
  const report = await convertRunningHeaders();
  note("Three pages repeat a confidentiality header and a page-number footer.");
  console.log("\n" + report.markdown + "\n");
  field("footers kept in JSON", report.footers.join(", "));
  field("saved JSON version", report.sourceVersion);

  step("4. keep a group header over two columns");
  const table = await convertGroupHeaderTable();
  note("\"Quarters\" covers the Q1 and Q2 columns, so it becomes one merged header cell.");
  field("header rows", table.headerRows);
  field("spans", JSON.stringify(table.spans));
  field("HTML", table.html);
  field("Markdown header", table.markdownHeader);

  step("5. join a table that continues onto the next page");
  const continued = await convertContinuedTable();
  note("Page 1 ends with three rows and page 2 starts with three more in the same columns.");
  field("rows", continued.rows.length);
  field("pages", JSON.stringify(continued.pages));
  field("row pages", JSON.stringify(continued.rowPages));
  console.log("\n" + continued.markdown + "\n");

  step("6. chunk it for retrieval");
  note("Each piece repeats the header row and cites only the page its rows came from.");
  for (const chunk of await chunkContinuedTable()) {
    field(`pages ${JSON.stringify(chunk.pages)}`, chunk.text.split("\n").slice(2).join(" "));
  }

  step("7. convert only the pages you need");
  const selected = await convertSelectedPage();
  note("PDF.js reads page 2 alone; the result keeps its original page number.");
  field("pages", JSON.stringify(selected.pages));
  console.log("\n" + selected.markdown + "\n");
}

if (isMain(import.meta.url)) await run(main);
