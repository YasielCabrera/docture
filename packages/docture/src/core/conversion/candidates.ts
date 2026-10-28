import type { LineSourceId } from "../domain/conversion.js";
import type { LayoutBox, LoadedPage, TextLayoutBlock, TextLine } from "../domain/geometry.js";
import { lineIdsOf, lineSourceId } from "./source-lines.js";

export interface Candidate {
  readonly id: string;
  /** Loader ids retained when one visual line is split into column candidates. */
  readonly sourceIds?: readonly string[];
  /** Canonical ids of the page lines this candidate holds. */
  readonly lineIds: readonly LineSourceId[];
  readonly pageNumber: number;
  readonly box: LayoutBox;
  readonly lines: readonly TextLine[];
  readonly role?: TextLayoutBlock["role"];
  readonly level?: number;
}

export type CandidateSource = "blocks" | "lines" | "text";

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function boxOfLines(lines: readonly TextLine[]): LayoutBox {
  const spans = lines.flatMap((line) => line.spans);
  if (spans.length === 0) {
    const y = Math.min(...lines.map((line) => line.y), 0);
    const bottom = Math.max(...lines.map((line) => line.y + line.height), 0);
    return { x: 0, y, width: 0, height: Math.max(0, bottom - y) };
  }
  const x = Math.min(...spans.map((span) => span.x));
  const y = Math.min(...spans.map((span) => span.y));
  const right = Math.max(...spans.map((span) => span.x + span.width));
  const bottom = Math.max(...spans.map((span) => span.y + span.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function unionBox(boxes: readonly LayoutBox[]): LayoutBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function candidatesFor(page: LoadedPage): { candidates: Candidate[]; source: CandidateSource } {
  const textBlocks = (page.blocks ?? []).filter(
    (block): block is TextLayoutBlock => block.kind === "text",
  );
  if (textBlocks.length > 0) {
    const lineIds = lineIdsOf(page, textBlocks.map((block) => block.lines));
    return {
      candidates: textBlocks.map((block, index) => ({
        id: block.id,
        lineIds: lineIds[index] ?? [],
        pageNumber: page.pageNumber,
        box: {
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
        },
        lines: block.lines,
        ...(block.role === undefined ? {} : { role: block.role }),
        ...(block.level === undefined ? {} : { level: block.level }),
      })),
      source: "blocks",
    };
  }

  if (page.lines !== undefined && page.lines.length > 0) {
    return {
      candidates: page.lines.map((line, index) => ({
        id: lineSourceId(page.pageNumber, index),
        lineIds: [lineSourceId(page.pageNumber, index)],
        pageNumber: page.pageNumber,
        box: boxOfLines([line]),
        lines: [line],
      })),
      source: "lines",
    };
  }

  return {
    candidates: page.text
      .split(/\r?\n\s*\r?\n/u)
      .filter((text) => text.trim().length > 0)
      .map((text, index) => ({
        id: `p${page.pageNumber}-paragraph-${index + 1}`,
        lineIds: [],
        pageNumber: page.pageNumber,
        box: { x: 0, y: 0, width: 0, height: 0 },
        lines: [{ text, y: 0, height: 0, spans: [] }],
      })),
    source: "text",
  };
}

export function fontSizes(candidate: Candidate): number[] {
  return candidate.lines.flatMap((line) =>
    line.spans.flatMap((span) =>
      span.style?.fontSize === undefined ? [] : [span.style.fontSize],
    ),
  );
}

/** Median font size of a page's candidates, the reference for heading thresholds. */
export function bodyFontSize(candidates: readonly Candidate[]): number {
  return median(candidates.flatMap(fontSizes).filter((size) => size > 0)) || 10;
}

/** A candidate this much larger than the body font size reads as a heading. */
export const HEADING_SIZE_RATIO = 1.18;

export function isTableCandidate(candidate: Candidate): boolean {
  if (candidate.role === "table") return true;
  if (candidate.lines.length !== 1) return false;
  const spans = candidate.lines[0]?.spans ?? [];
  if (spans.length < 2) return false;
  const typicalHeight = median(spans.map((span) => span.height).filter((height) => height > 0)) || 10;
  return spans.some((span, index) => {
    const next = spans[index + 1];
    return next !== undefined && next.x - (span.x + span.width) >= typicalHeight;
  });
}

export function compatibleTableRows(first: Candidate, next: Candidate): boolean {
  if (first.role === "table" && next.role === "table") return true;
  const a = first.lines[0]?.spans ?? [];
  const b = next.lines[0]?.spans ?? [];
  if (a.length !== b.length || a.length < 2) return false;
  const tolerance = Math.max(4, median([...a, ...b].map((span) => span.height)) * 1.25);
  return a.every((span, index) => Math.abs(span.x - (b[index]?.x ?? Number.POSITIVE_INFINITY)) <= tolerance);
}
