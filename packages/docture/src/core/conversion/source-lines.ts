import type { LineSourceId, SourceLine } from "../domain/conversion.js";
import type { LayoutBox, LoadedPage, TextLine } from "../domain/geometry.js";

const LINE_ID = /^p[1-9]\d*-line-[1-9]\d*$/u;

export function lineSourceId(pageNumber: number, index0: number): LineSourceId {
  return `p${pageNumber}-line-${index0 + 1}`;
}

function lineBox(line: TextLine): LayoutBox {
  if (line.spans.length === 0) return { x: 0, y: line.y, width: 0, height: line.height };
  const x = Math.min(...line.spans.map((span) => span.x));
  const y = Math.min(...line.spans.map((span) => span.y));
  const right = Math.max(...line.spans.map((span) => span.x + span.width));
  const bottom = Math.max(...line.spans.map((span) => span.y + span.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * List a page's positioned lines with their canonical ids. The id is
 * `p<pageNumber>-line-<I>`, where `I` is the 1-based index into `page.lines`.
 * Pages without positioned lines, such as text-only inputs, yield none.
 *
 * @example
 * ```ts
 * import { sourceLines } from "docture";
 *
 * const lines = sourceLines({
 *   pageNumber: 1,
 *   lines: [{ y: 20, height: 12, text: "Total 10", spans: [] }],
 * });
 * console.log(lines[0]?.id); // "p1-line-1"
 * ```
 */
export function sourceLines(page: Pick<LoadedPage, "pageNumber" | "lines">): readonly SourceLine[] {
  return (page.lines ?? []).map((line, index) => ({
    id: lineSourceId(page.pageNumber, index),
    pageNumber: page.pageNumber,
    box: lineBox(line),
    text: line.text,
  }));
}

/**
 * Whether `id` is a canonical line id such as `p3-line-12`. Page and line
 * numbers start at 1 and have no leading zeros.
 *
 * @example
 * ```ts
 * import { isLineSourceId } from "docture";
 *
 * isLineSourceId("p3-line-12"); // true
 * isLineSourceId("p3-text-12"); // false
 * ```
 */
export function isLineSourceId(id: string): id is LineSourceId {
  return LINE_ID.test(id);
}

/**
 * Line ids for groups of lines taken from `page`, one result per group. A line
 * matches by object identity first, then by the first unclaimed line with the
 * same `y`, `height` and `text`. A line with no match gets no id.
 */
export function lineIdsOf(
  page: Pick<LoadedPage, "pageNumber" | "lines">,
  groups: readonly (readonly TextLine[])[],
): LineSourceId[][] {
  const lines = page.lines ?? [];
  const byIdentity = new Map(lines.map((line, index) => [line, index]));
  const claimed = new Set<number>();
  const wanted = groups.map((group) => group.map((line) => byIdentity.get(line)));
  for (const index of wanted.flat()) if (index !== undefined) claimed.add(index);
  return groups.map((group, groupIndex) => group.flatMap((line, lineIndex) => {
    let index = wanted[groupIndex]?.[lineIndex];
    if (index === undefined) {
      index = lines.findIndex((candidate, position) =>
        !claimed.has(position) &&
        candidate.y === line.y && candidate.height === line.height && candidate.text === line.text);
      if (index < 0) return [];
      claimed.add(index);
    }
    return [lineSourceId(page.pageNumber, index)];
  }));
}
