import type { LayoutRoleHint, LoadedDocument, LoadedPage, TextSpan } from "../../src/core/index.js";
import { line, span } from "./conversion-fixtures.js";

export interface Row {
  readonly text: string;
  readonly y: number;
  readonly x?: number;
  readonly size?: number;
  readonly role?: LayoutRoleHint;
  readonly cells?: readonly (readonly [string, number])[];
}

export function pdfPage(pageNumber: number, rows: readonly Row[], size = { width: 600, height: 800 }): LoadedPage {
  const lines = rows.map((row) => {
    const style = { fontSize: row.size ?? 11 };
    const spans: TextSpan[] = row.cells === undefined
      ? [span(row.text, row.x ?? 40, row.y, { style })]
      : row.cells.map(([text, x]) => span(text, x, row.y, { style }));
    return line(row.y, spans);
  });
  return {
    pageNumber,
    ...size,
    text: lines.map((item) => item.text).join("\n"),
    lines,
    blocks: lines.map((item, index) => {
      const first = item.spans[0];
      const last = item.spans[item.spans.length - 1];
      const x = first?.x ?? 0;
      const role = rows[index]?.role;
      return {
        id: `p${pageNumber}-text-${index + 1}`,
        kind: "text" as const,
        x,
        y: item.y,
        width: (last === undefined ? 0 : last.x + last.width) - x,
        height: item.height,
        lines: [item],
        ...(role === undefined ? {} : { role }),
      };
    }),
  };
}

export function documentOf(pages: readonly LoadedPage[], loader = "furniture-fixture"): LoadedDocument {
  return { loader, form: "digital", text: pages.map((page) => page.text).join("\f"), pages };
}

export function acmeReport(pageCount = 3): LoadedDocument {
  return documentOf(Array.from({ length: pageCount }, (_unused, index) => pdfPage(index + 1, [
    { text: "ACME Corp Confidential", y: 20 },
    { text: `Body text of page ${index + 1}.`, y: 100 },
    { text: `Page ${index + 1} of ${pageCount}`, y: 780 },
  ])));
}

export function bookSpread(): LoadedDocument {
  return documentOf(Array.from({ length: 6 }, (_unused, index) => {
    const pageNumber = index + 1;
    const odd = pageNumber % 2 === 1;
    return pdfPage(pageNumber, [
      { text: odd ? "The Docture Handbook" : "Chapter 2: Layout", y: 24 },
      { text: `Prose on page ${pageNumber}.`, y: 120 },
      { text: String(pageNumber), y: 770, x: odd ? 540 : 50 },
    ]);
  }));
}

export function threePages(top: (pageNumber: number) => Row): LoadedDocument {
  return documentOf([1, 2, 3].map((pageNumber) => pdfPage(pageNumber, [
    top(pageNumber),
    { text: `Body ${pageNumber}.`, y: 200 },
  ])));
}
