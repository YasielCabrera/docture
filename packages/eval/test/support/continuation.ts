import type { LoadedDocument, LoadedPage, TextLine } from "docture";

interface FixtureLine {
  readonly y: number;
  readonly cells: readonly (readonly [string, number])[];
}

const row = (y: number, ...cells: readonly (readonly [string, number])[]): FixtureLine => ({ y, cells });

function page(pageNumber: number, items: readonly FixtureLine[]): LoadedPage {
  const lines: TextLine[] = items.map((item) => {
    const spans = item.cells.map(([text, x]) => ({ text, x, y: item.y, width: Math.max(10, text.length * 5), height: 12, style: { fontSize: 11 } }));
    return { y: item.y, height: 12, text: spans.map((span) => span.text).join(" "), spans };
  });
  return {
    pageNumber,
    width: 600,
    height: 800,
    text: lines.map((line) => line.text).join("\n"),
    lines,
    blocks: lines.map((line, index) => {
      const x = Math.min(...line.spans.map((span) => span.x));
      const right = Math.max(...line.spans.map((span) => span.x + span.width));
      return { id: `p${pageNumber}-text-${index + 1}`, kind: "text" as const, x, y: line.y, width: right - x, height: 12, lines: [line] };
    }),
  };
}

/** A loaded document with one page per list of rows. */
export function fixtureDocument(...pages: readonly (readonly FixtureLine[])[]): LoadedDocument {
  const loaded = pages.map((items, index) => page(index + 1, items));
  return { loader: "continuation-fixture", form: "digital", text: loaded.map((item) => item.text).join("\f"), pages: loaded };
}

/** A two-column table that starts at the bottom of a page. */
export const tableAtPageBottom: readonly FixtureLine[] = [
  row(640, ["Item", 40], ["Amount", 200]),
  row(660, ["Alpha", 40], ["10", 200]),
  row(680, ["Beta", 40], ["20", 200]),
];

/** Rows at the top of the next page that continue {@link tableAtPageBottom}. */
export const continuationRows: readonly FixtureLine[] = [
  row(100, ["Gamma", 40], ["30", 200]),
  row(120, ["Delta", 40], ["40", 200]),
  row(140, ["Epsilon", 40], ["50", 200]),
];
