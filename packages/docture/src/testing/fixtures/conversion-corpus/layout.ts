import type { LoadedDocument, LoadedPage, TextLine } from "../../../core/index.js";

export type CorpusCell = readonly [text: string, x: number, width?: number, fontSize?: number];

export interface CorpusLine {
  readonly y: number;
  readonly cells: readonly CorpusCell[];
  readonly fontSize?: number;
  readonly height?: number;
  readonly bold?: boolean;
}

export interface CorpusPage {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly CorpusLine[];
}

export const line = (y: number, ...cells: readonly CorpusCell[]): CorpusLine => ({ y, cells });
export const boldLine = (y: number, ...cells: readonly CorpusCell[]): CorpusLine => ({ y, cells, bold: true });
export const letter = (...lines: readonly CorpusLine[]): CorpusPage => ({ width: 600, height: 800, lines });

function loadedPage(pageNumber: number, page: CorpusPage): LoadedPage {
  const lines = page.lines.map((item): TextLine => {
    const height = item.height ?? 12;
    const spans = item.cells.map(([text, x, width, fontSize]) => ({
      text,
      x,
      y: item.y,
      width: width ?? Math.max(10, text.length * 5),
      height,
      style: { fontSize: fontSize ?? item.fontSize ?? 11, ...(item.bold === true ? { bold: true } : {}) },
    }));
    return { y: item.y, height, text: spans.map((span) => span.text).join(" "), spans };
  });
  return {
    pageNumber,
    width: page.width,
    height: page.height,
    text: lines.map((item) => item.text).join("\n"),
    lines,
    blocks: lines.map((item, index) => {
      const x = Math.min(...item.spans.map((span) => span.x));
      const right = Math.max(...item.spans.map((span) => span.x + span.width));
      return { id: `p${pageNumber}-text-${index + 1}`, kind: "text" as const, x, y: item.y, width: right - x, height: item.height, lines: [item] };
    }),
  };
}

export function corpusDocument(...pages: readonly CorpusPage[]): LoadedDocument {
  const loaded = pages.map((page, index) => loadedPage(index + 1, page));
  return { loader: "conversion-corpus", form: "digital", text: loaded.map((page) => page.text).join("\f"), pages: loaded };
}
