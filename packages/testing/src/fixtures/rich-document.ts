/** A layout-rich, deterministic PDF used by converter integration tests. */

import PDFDocument from "pdfkit";
import type { SyntheticDocument } from "./invoice.js";

export interface RichDocumentExpected {
  readonly title: string;
  readonly intro: string;
  readonly linkText: string;
  readonly linkHref: string;
  readonly leftColumn: readonly string[];
  readonly rightColumn: readonly string[];
  readonly listItems: readonly string[];
  readonly table: readonly (readonly string[])[];
  readonly code: string;
  readonly secondPage: string;
  /** Every substantive string written into the PDF. */
  readonly sourceText: readonly string[];
}

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export function richDocumentExpected(): RichDocumentExpected {
  const title = "Document Conversion Fixture";
  const intro = "Grounded text stays exact: <alpha> & beta.";
  const linkText = "Docture documentation";
  const linkHref = "https://example.com/docture";
  const leftColumn = ["Left column starts here.", "It keeps its own reading order."];
  const rightColumn = ["Right column starts here.", "Typography drives structure."];
  const listItems = ["First deterministic item", "Second deterministic item"];
  const table = [
    ["Metric", "Value"],
    ["Accuracy", "100"],
    ["Pages", "2"],
  ];
  const code = "const grounded = '<unchanged>';";
  const secondPage = "Second page provenance remains explicit.";
  return {
    title,
    intro,
    linkText,
    linkHref,
    leftColumn,
    rightColumn,
    listItems,
    table,
    code,
    secondPage,
    sourceText: [
      title,
      intro,
      linkText,
      ...leftColumn,
      ...rightColumn,
      ...listItems,
      ...table.flat(),
      code,
      secondPage,
    ],
  };
}

/** Generate a two-page PDF with columns, styles, table, link, code, and raster art. */
export function makeRichDocumentPdf(): Promise<SyntheticDocument<RichDocumentExpected>> {
  const expected = richDocumentExpected();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      compress: false,
      info: {
        Title: expected.title,
        Author: "Docture tests",
        Subject: "Deterministic document conversion",
      },
    });
    const chunks: Buffer[] = [];
    let pageCount = 1;
    doc.on("pageAdded", () => {
      pageCount += 1;
    });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () =>
      resolve({ bytes: new Uint8Array(Buffer.concat(chunks)), expected, pageCount }),
    );

    try {
      doc.font("Helvetica-Bold").fontSize(24).text(expected.title, 42, 42);
      doc.font("Helvetica").fontSize(11).text(expected.intro, 42, 84);
      doc.fillColor("blue").text(expected.linkText, 42, 104, { link: expected.linkHref, underline: true });
      doc.fillColor("black");

      doc.font("Helvetica-Bold").fontSize(14).text("Two columns", 42, 142);
      doc.font("Helvetica").fontSize(10);
      expected.leftColumn.forEach((text, index) => doc.text(text, 42, 174 + index * 18, { width: 220 }));
      expected.rightColumn.forEach((text, index) => doc.text(text, 320, 174 + index * 18, { width: 220 }));

      doc.font("Helvetica-Bold").fontSize(14).text("List", 42, 244);
      doc.font("Helvetica").fontSize(10);
      expected.listItems.forEach((text, index) => doc.text(`• ${text}`, 52, 272 + index * 18));

      doc.font("Helvetica-Bold").fontSize(14).text("Table", 42, 326);
      expected.table.forEach((row, rowIndex) => {
        doc.font(rowIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        doc.text(row[0] ?? "", 42, 356 + rowIndex * 20);
        doc.text(row[1] ?? "", 220, 356 + rowIndex * 20);
      });

      doc.font("Courier").fontSize(10).text(expected.code, 42, 442);
      doc.image(PIXEL_PNG, 42, 480, { width: 36, height: 36 });

      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(18).text("Continuation", 42, 42);
      doc.font("Helvetica").fontSize(11).text(expected.secondPage, 42, 82);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
