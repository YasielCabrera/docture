import type { LayoutAnnotation } from "../contracts/layout-analyzer.js";
import type {
  CodeElement,
  ConversionWarning,
  DocumentElement,
  ElementProvenance,
  HeadingElement,
  InlineText,
  LayoutDocument,
  LayoutPage,
  LineSourceId,
  ListElement,
  PageFooterElement,
  PageHeaderElement,
  ParagraphElement,
  ProvenanceSegment,
  TableElement,
} from "../domain/conversion.js";
import type {
  LayoutBlock,
  LayoutBox,
  LoadedDocument,
  LoadedPage,
  TextLine,
  TextSpan,
} from "../domain/geometry.js";
import {
  bodyFontSize,
  boxOfLines,
  candidatesFor,
  characterFontSize,
  fontSizes,
  HEADING_SIZE_RATIO,
  isBold,
  isMonospace,
  isRotated,
  median,
  mostCharacters,
  ORDERED_MARKER,
  unionBox,
  UNORDERED_MARKER,
  type Candidate,
} from "./candidates.js";
import {
  appendParagraph,
  continuesParagraph,
  leadingBandLines,
  positioned,
  tableTraits,
  takeTableContinuation,
  trailingBandLines,
  type PageFrame,
  type TableContinuation,
  type TableTraits,
} from "./continuation.js";
import { joinSpans, spanSeparator } from "../domain/lines.js";
import { withElementIds } from "./element-ids.js";
import { detectFurniture, type Furniture } from "./furniture.js";
import { mergeCandidates, paragraphLength } from "./paragraphs.js";
import { provenanceSegments } from "./provenance.js";
import { looksLikeTableGroup, tableGroupAt, tableGroupIds, tableLabel, tableRowIds, unresolvedGroupLabel, type TableGroup } from "./table-grid.js";
import { appendTableRows } from "./tables.js";

export interface DeterministicAnalysis {
  readonly document: LayoutDocument;
  readonly warnings: readonly ConversionWarning[];
}

/**
 * Sort blocks by columns when the geometry clearly separates them. Blocks that
 * span most of the page remain in vertical order and naturally split columns.
 */
function readingOrder(candidates: readonly Candidate[], pageWidth: number, gutter: number | undefined): Candidate[] {
  const leftEdge = gutter ?? pageWidth * 0.56;
  const rightEdge = gutter ?? pageWidth * 0.44;
  const narrow = gutter === undefined
    ? candidates.filter((candidate) => candidate.box.width < pageWidth * 0.6)
    : candidates;
  const left = narrow.filter((candidate) => candidate.box.x + candidate.box.width <= leftEdge);
  const right = narrow.filter((candidate) => candidate.box.x >= rightEdge);
  const aligned = (first: Candidate, second: Candidate): boolean => {
    const overlap =
      Math.min(first.box.y + first.box.height, second.box.y + second.box.height) -
      Math.max(first.box.y, second.box.y);
    return overlap > 0 || Math.abs(first.box.y - second.box.y) <= Math.max(first.box.height, second.box.height);
  };
  const matchedLeft = left.filter((candidate) => right.some((other) => aligned(candidate, other)));
  const matchedRight = right.filter((candidate) => left.some((other) => aligned(candidate, other)));
  const isTwoColumn = matchedLeft.length >= 2 && matchedRight.length >= 2;

  if (!isTwoColumn) {
    return [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }

  const columnTop = Math.min(...[...matchedLeft, ...matchedRight].map((candidate) => candidate.box.y));
  const columnBottom = Math.max(continuedBottom(left, matchedLeft), continuedBottom(right, matchedRight));
  const before = candidates
    .filter((candidate) => candidate.box.y + candidate.box.height <= columnTop)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const after = candidates
    .filter((candidate) => candidate.box.y >= columnBottom)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const middle = candidates.filter(
    (candidate) => !before.includes(candidate) && !after.includes(candidate),
  );
  const ordered: Candidate[] = [...before];
  const remaining = new Set(middle);
  const spanning = middle
    .filter(
      (candidate) =>
        candidate.box.x < rightEdge &&
        candidate.box.x + candidate.box.width > leftEdge,
    )
    .sort((a, b) => a.box.y - b.box.y);
  let top = columnTop;

  const column = (box: LayoutBox): number => (box.x + box.width / 2 < (gutter ?? pageWidth / 2) ? 0 : 1);
  const appendBand = (include: (box: LayoutBox) => boolean): void => {
    const band = middle.filter((candidate) => remaining.has(candidate) && candidate.box.y >= top && include(candidate.box));
    for (const candidate of band.sort((a, b) => column(a.box) - column(b.box) || a.box.y - b.box.y || a.box.x - b.box.x)) {
      ordered.push(candidate);
      remaining.delete(candidate);
    }
  };

  for (const block of spanning) {
    const bottom = block.box.y + block.box.height;
    appendBand((box) => box.y < block.box.y || (box.y < bottom && box.x + box.width <= block.box.x));
    ordered.push(block);
    remaining.delete(block);
    appendBand((box) => box.y < bottom && box.x >= block.box.x + block.box.width);
    top = bottom;
  }
  appendBand(() => true);
  top = Number.NEGATIVE_INFINITY;
  appendBand(() => true);
  return [...ordered, ...after];
}

function continuedBottom(column: readonly Candidate[], matched: readonly Candidate[]): number {
  let bottom = Math.max(...matched.map((candidate) => candidate.box.y + candidate.box.height));
  for (const candidate of [...column].sort((a, b) => a.box.y - b.box.y)) {
    if (candidate.box.y < bottom) continue;
    if (candidate.box.y - bottom > candidate.box.height * 2) break;
    bottom = candidate.box.y + candidate.box.height;
  }
  return bottom;
}

function hasAmbiguousReadingOrder(candidates: readonly Candidate[]): boolean {
  const byTop = [...candidates].sort((a, b) => a.box.y - b.box.y);
  for (const [index, candidate] of byTop.entries()) {
    for (let next = index + 1; next < byTop.length; next += 1) {
      const other = byTop[next];
      if (other === undefined || other.box.y >= candidate.box.y + candidate.box.height) break;
      const verticalOverlap =
        Math.min(candidate.box.y + candidate.box.height, other.box.y + other.box.height) -
        Math.max(candidate.box.y, other.box.y);
      const horizontalOverlap =
        Math.min(candidate.box.x + candidate.box.width, other.box.x + other.box.width) -
        Math.max(candidate.box.x, other.box.x);
      if (
        verticalOverlap > Math.min(candidate.box.height, other.box.height) * 0.5 &&
        horizontalOverlap > Math.min(candidate.box.width, other.box.width) * 0.25
      ) {
        return true;
      }
    }
  }
  return false;
}

function allSpans(candidate: Candidate): readonly TextSpan[] {
  return candidate.lines.flatMap((line) => line.spans);
}

function inlineFromLines(lines: readonly TextLine[]): InlineText[] {
  const runs: InlineText[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const [spanIndex, span] of line.spans.entries()) {
      const previous = line.spans[spanIndex - 1];
      const separator = previous === undefined ? "" : spanSeparator(previous, span);
      if (separator !== "") runs.push({ text: separator });
      runs.push({ text: span.text, ...(span.href === undefined ? {} : { href: span.href }) });
    }
    if (lineIndex + 1 < lines.length) runs.push({ text: "\n" });
  }
  if (runs.length === 0) {
    return lines.map((line, index) => ({ text: `${index === 0 ? "" : "\n"}${line.text}` }));
  }
  return runs;
}

function textOf(runs: readonly InlineText[]): string {
  return runs.map((run) => run.text).join("");
}

function withLineIds(
  provenance: Omit<ElementProvenance, "lineIds">,
  lineIds: readonly LineSourceId[],
): ElementProvenance {
  const unique = [...new Set(lineIds)];
  return unique.length === 0 ? provenance : { ...provenance, lineIds: unique };
}

function provenance(candidates: readonly Candidate[]): ElementProvenance {
  const first = candidates[0];
  return withLineIds({
    pageNumber: first?.pageNumber ?? 0,
    box: unionBox(candidates.map((candidate) => candidate.box)),
    sourceIds: candidates.flatMap((candidate) => candidate.sourceIds ?? [candidate.id]),
  }, candidates.flatMap((candidate) => candidate.lineIds));
}

function rowSegments(candidate: Candidate): ProvenanceSegment[] {
  const aligned = candidate.lineIds.length === candidate.lines.length;
  return candidate.lines.map((line, index) => {
    const id = aligned ? candidate.lineIds[index] : undefined;
    return {
      pageNumber: candidate.pageNumber,
      box: boxOfLines([line]),
      sourceIds: candidate.sourceIds ?? [candidate.id],
      ...(id === undefined ? {} : { lineIds: [id] }),
    };
  });
}

function headingLevel(size: number, bodySize: number): 1 | 2 | 3 | 4 | 5 | 6 {
  const ratio = bodySize <= 0 ? 1 : size / bodySize;
  if (ratio >= 2) return 1;
  if (ratio >= 1.7) return 2;
  if (ratio >= 1.45) return 3;
  if (ratio >= 1.3) return 4;
  if (ratio >= 1.18) return 5;
  return 6;
}

const HEADING_TIER_TOLERANCE = 0.05;

function documentHeadingLevels(sizes: ReadonlyMap<DocumentElement, number>): Map<DocumentElement, HeadingElement["level"]> {
  const tiers: number[] = [];
  for (const size of [...new Set(sizes.values())].sort((a, b) => b - a)) {
    const smallest = tiers.at(-1);
    if (smallest === undefined || size < smallest * (1 - HEADING_TIER_TOLERANCE)) tiers.push(size);
  }
  const levels = new Map<DocumentElement, HeadingElement["level"]>();
  for (const [element, size] of sizes) {
    const tier = tiers.findIndex((top) => size >= top * (1 - HEADING_TIER_TOLERANCE));
    levels.set(element, Math.min(6, tier + 1) as HeadingElement["level"]);
  }
  return levels;
}

/** Larger than the body by more than the size variation of one paragraph's lines. */
const NUMBERED_TITLE_RATIO = 1.1;


function listKind(text: string): "ordered" | "unordered" | undefined {
  if (ORDERED_MARKER.test(text)) return "ordered";
  if (UNORDERED_MARKER.test(text)) return "unordered";
  return undefined;
}

function withoutPrefix(runs: readonly InlineText[], length: number): InlineText[] {
  let remaining = length;
  return runs.flatMap((run) => {
    if (remaining <= 0) return [run];
    const cut = Math.min(remaining, run.text.length);
    remaining -= cut;
    return cut === run.text.length ? [] : [{ ...run, text: run.text.slice(cut) }];
  });
}

function originalListMarker(text: string): string | undefined {
  return ORDERED_MARKER.exec(text)?.[0] ?? UNORDERED_MARKER.exec(text)?.[0];
}

/**
 * A numbered line set larger than the body text, such as `2. Transactions`, is
 * a section title rather than a one-item list. List items share the body size.
 */
function isNumberedSectionTitle(lines: readonly Candidate[], bodySize: number): boolean {
  const size = median(lines.flatMap(fontSizes));
  const text = lines.flatMap((candidate) => candidate.lines.map((line) => line.text)).join(" ");
  return fitsTitle(text, lines.length) && size > 0 && bodySize > 0 && size >= bodySize * NUMBERED_TITLE_RATIO;
}

function setInBold(candidates: readonly Candidate[]): boolean {
  const inked = candidates.flatMap(allSpans).filter((span) => span.text.trim() !== "");
  return inked.length > 0 && inked.every(isBold);
}

function isBoldNumberedTitle(title: readonly Candidate[], next: Candidate | undefined): boolean {
  const line = title.length === 1 ? title[0]?.lines : undefined;
  if (line?.length !== 1 || next === undefined || !setInBold(title) || setInBold([next])) return false;
  const text = line[0]?.text ?? "";
  return fitsTitle(text, 1) && listKind(next.lines.map((value) => value.text).join("\n")) === undefined;
}

/** A title runs to at most two lines: 120 characters on one line, 200 when it wraps. */
function fitsTitle(text: string, lineCount: number): boolean {
  const length = text.trim().length;
  return lineCount === 1 ? length <= 120 : lineCount === 2 && length <= 200;
}

interface CandidateGap {
  readonly spanBefore: number;
  readonly boundary: number;
  readonly atClearGutter?: true;
}

interface Gutter {
  readonly boundary: number;
  readonly minWidth: number;
}

const GUTTER_HEIGHTS = 1.2;

interface SpanGap {
  readonly spanBefore: number;
  readonly start: number;
  readonly end: number;
}

function gapsAtLeast(spans: readonly TextSpan[], width: number): SpanGap[] {
  return spans.slice(1).flatMap((next, index) => {
    const previous = spans[index];
    if (previous === undefined) return [];
    const start = previous.x + previous.width;
    return next.x - start >= width ? [{ spanBefore: index, start, end: next.x }] : [];
  });
}

function clearGutter(candidates: readonly Candidate[], pageWidth: number): Gutter | undefined {
  const lines = candidates.filter((candidate) => candidate.lines.length === 1).flatMap((candidate) => candidate.lines);
  const height = median(lines.flatMap((line) => line.spans.map((span) => span.height)).filter((value) => value > 0));
  if (height <= 0) return undefined;
  const minWidth = height * GUTTER_HEIGHTS;
  const gaps = lines.flatMap((line) => {
    const wide = gapsAtLeast(line.spans, minWidth);
    const gap = wide[0];
    if (gap === undefined || wide.length !== 1) return [];
    const left = line.spans[0]?.x ?? 0;
    const right = Math.max(...line.spans.map((span) => span.x + span.width));
    const middle = (gap.start + gap.end) / 2;
    const prose = gap.start - left >= pageWidth * 0.25 && right - gap.end >= pageWidth * 0.25;
    return prose && middle > pageWidth * 0.3 && middle < pageWidth * 0.7 ? [{ ...gap, middle, y: line.y }] : [];
  });
  let best: { boundary: number; count: number } | undefined;
  for (const boundary of new Set(gaps.map((gap) => Math.round(gap.middle)))) {
    const splitting = gaps.filter((gap) => gap.start <= boundary && gap.end >= boundary);
    if (splitting.length < 3 || (best !== undefined && splitting.length <= best.count)) continue;
    const top = Math.min(...splitting.map((gap) => gap.y));
    const bottom = Math.max(...splitting.map((gap) => gap.y));
    const crossing = lines.filter((line) => line.y >= top && line.y <= bottom &&
      line.spans.some((span) => span.x < boundary && span.x + span.width > boundary)).length;
    if (crossing * 4 <= splitting.length) best = { boundary, count: splitting.length };
  }
  return best === undefined ? undefined : { boundary: best.boundary, minWidth };
}

function columnGap(candidate: Candidate, pageWidth: number, gutter: Gutter | undefined): CandidateGap | undefined {
  if (candidate.lines.length !== 1) return undefined;
  const spans = candidate.lines[0]?.spans ?? [];
  let best: { index: number; size: number; boundary: number } | undefined;
  for (let index = 0; index + 1 < spans.length; index += 1) {
    const current = spans[index];
    const next = spans[index + 1];
    if (current === undefined || next === undefined) continue;
    const start = current.x + current.width;
    const size = next.x - start;
    if (best === undefined || size > best.size) {
      best = { index, size, boundary: start + size / 2 };
    }
  }
  if (best !== undefined && best.size >= Math.max(24, pageWidth * 0.08)) {
    const start = best.boundary - best.size / 2;
    return gutter !== undefined && start <= gutter.boundary && start + best.size >= gutter.boundary
      ? { spanBefore: best.index, boundary: gutter.boundary, atClearGutter: true }
      : { spanBefore: best.index, boundary: best.boundary };
  }
  if (gutter === undefined) return undefined;
  const wide = gapsAtLeast(spans, gutter.minWidth);
  const gap = wide[0];
  return wide.length === 1 && gap !== undefined && gap.start <= gutter.boundary && gap.end >= gutter.boundary
    ? { spanBefore: gap.spanBefore, boundary: gutter.boundary, atClearGutter: true }
    : undefined;
}

function splitCandidate(candidate: Candidate, gap: CandidateGap): Candidate[] {
  const line = candidate.lines[0];
  if (line === undefined) return [candidate];
  const halves = [line.spans.slice(0, gap.spanBefore + 1), line.spans.slice(gap.spanBefore + 1)];
  const sizes = halves.map(characterFontSize);
  const largest = Math.max(...sizes);
  return halves.flatMap(
    (spans, index) => {
      if (spans.length === 0) return [];
      const { role, level, ...rest } = candidate;
      const keepsRole = role !== "heading" || (sizes[index] ?? 0) >= largest;
      const splitLine: TextLine = {
        y: line.y,
        height: line.height,
        text: joinSpans(spans),
        spans,
      };
      return [{
        ...rest,
        ...(keepsRole && role !== undefined ? { role } : {}),
        ...(keepsRole && level !== undefined ? { level } : {}),
        id: `${candidate.id}-column-${index + 1}`,
        sourceIds: candidate.sourceIds ?? [candidate.id],
        box: boxOfLines([splitLine]),
        lines: [splitLine],
      }];
    },
  );
}

/**
 * Text-layer loaders often return one visual line containing both columns. A
 * repeated wide gutter, or a narrow one that no text crosses, is column evidence
 * unless typography marks the same rows as a table. Splitting here gives the
 * reading-order pass real column blocks.
 */
function splitColumnCandidates(
  candidates: readonly Candidate[],
  pageWidth: number,
  acceptTable: (group: TableGroup) => boolean,
  gutter: Gutter | undefined,
): Candidate[] {
  const bandTables = tableGroupIds(candidates, (group) => group.rule === "bands" && acceptTable(group));
  const output: Candidate[] = [];
  for (let index = 0; index < candidates.length; ) {
    const candidate = candidates[index];
    if (candidate === undefined) break;
    const firstGap = columnGap(candidate, pageWidth, gutter);
    if (firstGap === undefined) {
      output.push(candidate);
      index += 1;
      continue;
    }

    const group: { candidate: Candidate; gap: CandidateGap }[] = [{ candidate, gap: firstGap }];
    for (let cursor = index + 1; cursor < candidates.length; cursor += 1) {
      const next = candidates[cursor];
      if (next === undefined) break;
      const gap = columnGap(next, pageWidth, gutter);
      if (
        gap === undefined ||
        Math.abs(gap.boundary - firstGap.boundary) > pageWidth * 0.08
      ) {
        break;
      }
      group.push({ candidate: next, gap });
    }

    const minimum = group.every((item) => item.gap.atClearGutter === true) ? 1 : 2;
    if (group.length >= minimum) {
      const splittableLines = group.filter((item) => !bandTables.has(item.candidate.id));
      if (looksLikeTableGroup(group.map((item) => item.candidate)) || splittableLines.length < minimum) {
        output.push(...group.map((item) => item.candidate));
      } else {
        output.push(...group.flatMap((item) =>
          bandTables.has(item.candidate.id) ? [item.candidate] : splitCandidate(item.candidate, item.gap)));
      }
      index += group.length;
      continue;
    }
    output.push(candidate);
    index += 1;
  }
  return output;
}

/** Code lines with the leading spaces their left edges show, measured in the listing's character width. */
function indentedCode(lines: readonly TextLine[]): string | undefined {
  const lefts = lines.flatMap((line) => line.spans.slice(0, 1).map((span) => span.x));
  const character = median(lines.flatMap((line) => line.spans)
    .filter((span) => span.text.length > 0 && span.width > 0)
    .map((span) => span.width / span.text.length));
  if (lines.length < 2 || lefts.length !== lines.length || character <= 0) return undefined;
  const margin = Math.min(...lefts);
  return lines
    .map((line, index) => " ".repeat(Math.round(((lefts[index] ?? margin) - margin) / character)) + line.text.trimStart())
    .join("\n");
}

const TRAILING_AMOUNT = /(?:\p{Sc}\s?-?[\d.,]+|:\s*-?[\d,]*\d\.\d{2}|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/u;

function readsAsTitle(text: string, spans: readonly TextSpan[]): boolean {
  if (TRAILING_AMOUNT.test(text.trim())) return false;
  return !spans.some((span, index) => {
    const previous = spans[index - 1];
    return previous !== undefined &&
      span.x - (previous.x + previous.width) > 2 * Math.max(span.height, previous.height);
  });
}

type HeadingSizes = Map<DocumentElement, number>;

function elementForCandidate(
  candidate: Candidate,
  bodySize: number,
  headingSizes: HeadingSizes,
): HeadingElement | ParagraphElement | CodeElement {
  const runs = inlineFromLines(candidate.lines);
  const text = textOf(runs);
  const spans = allSpans(candidate);
  const sizes = fontSizes(candidate);
  const size = median(sizes);
  const inked = spans.filter((span) => span.text.trim() !== "");
  const allBold = inked.length > 0 && inked.every(isBold);
  const mostlyMono = mostCharacters(spans, isMonospace);
  const fits = fitsTitle(text, candidate.lines.length) && /\p{L}/u.test(text);
  const isHeading =
    candidate.role === "heading" ||
    (size > 0 && bodySize > 0 && size >= bodySize * HEADING_SIZE_RATIO && fits) ||
    (allBold && fits && candidate.lines.length === 1 && size >= bodySize && readsAsTitle(text, inked));

  if (isHeading) {
    const tagged = candidate.level !== undefined && candidate.level >= 1 && candidate.level <= 6;
    const heading: HeadingElement = {
      id: candidate.id,
      kind: "heading",
      level: tagged ? (candidate.level as HeadingElement["level"]) : headingLevel(size, bodySize),
      text,
      runs,
      provenance: provenance([candidate]),
    };
    if (!tagged && size > 0) headingSizes.set(heading, size);
    return heading;
  }

  if (candidate.role === "code" || mostlyMono) {
    return {
      id: candidate.id,
      kind: "code",
      text: indentedCode(candidate.lines) ?? text,
      provenance: provenance([candidate]),
    };
  }

  return {
    id: candidate.id,
    kind: "paragraph",
    text,
    runs,
    provenance: provenance([candidate]),
  };
}

function analyzeTextCandidates(
  candidates: readonly Candidate[],
  bodySize: number,
  acceptTable: (group: TableGroup) => boolean,
  traits: Map<DocumentElement, TableTraits>,
  warnings: ConversionWarning[],
  gutter: number | undefined,
  headingSizes: HeadingSizes,
): DocumentElement[] {
  const elements: DocumentElement[] = [];
  const opensBlock = (start: number): boolean => {
    const next = candidates[start];
    return next === undefined || listKind(next.lines.map((line) => line.text).join("\n")) !== undefined ||
      tableGroupAt(candidates, start, acceptTable) !== undefined;
  };

  for (let index = 0; index < candidates.length; ) {
    const candidate = candidates[index];
    if (candidate === undefined) break;
    const rawText = candidate.lines.map((line) => line.text).join("\n");
    const kind = listKind(rawText);

    if (kind === "ordered") {
      const title = candidates.slice(index, index + paragraphLength(candidates, index, opensBlock, gutter));
      if (isNumberedSectionTitle(title, bodySize) || isBoldNumberedTitle(title, candidates[index + title.length])) {
        elements.push(elementForCandidate({ ...mergeCandidates(title), role: "heading" }, bodySize, headingSizes));
        index += title.length;
        continue;
      }
    }

    if (kind !== undefined || candidate.role === "list-item") {
      const members: Candidate[][] = [];
      let cursor = index;
      while (cursor < candidates.length) {
        const first = candidates[cursor];
        if (first === undefined) break;
        const firstKind = listKind(first.lines.map((line) => line.text).join("\n"));
        if (first.role !== "list-item" && (firstKind === undefined || firstKind !== kind)) break;
        if (firstKind !== undefined && kind !== undefined && firstKind !== kind) break;
        const length = paragraphLength(candidates, cursor, opensBlock, gutter);
        const lines = candidates.slice(cursor, cursor + length);
        if (cursor > index && firstKind === "ordered" && isNumberedSectionTitle(lines, bodySize)) break;
        cursor += length;
        const previous = members.at(-1);
        const opener = previous?.[0];
        if (firstKind === undefined && previous !== undefined && opener !== undefined && listKind(opener.lines[0]?.text ?? "") !== undefined) {
          previous.push(...lines);
        } else members.push([...lines]);
      }
      const grouped = members.map(mergeCandidates);
      const items = grouped.map((next) => {
        const markedRuns = inlineFromLines(next.lines);
        const marker = originalListMarker(textOf(markedRuns));
        const runs = withoutPrefix(markedRuns, marker?.length ?? 0);
        return { text: textOf(runs), runs, ...(marker === undefined ? {} : { marker }) };
      });
      const element: ListElement = {
        id: grouped[0]?.id ?? candidate.id,
        kind: "list",
        ordered: kind === "ordered",
        items,
        provenance: provenance(grouped),
      };
      elements.push(element);
      index = cursor;
      continue;
    }

    const table = tableGroupAt(candidates, index, acceptTable);
    if (table !== undefined) {
      const grouped = table.candidates;
      const element: TableElement = {
        id: grouped[0]?.id ?? candidate.id,
        kind: "table",
        rows: table.rows,
        headerRows: table.headerRows,
        ...(table.spans === undefined ? {} : { spans: table.spans }),
        rowProvenance: grouped.flatMap(rowSegments),
        sourceText: grouped.flatMap((item) => item.lines.map((value) => value.text)).join("\n"),
        provenance: provenance(grouped),
      };
      const found = tableTraits(table);
      if (found !== undefined) traits.set(element, found);
      const label = candidates[index - 1];
      const columns = label?.lines.length !== 1 || label.lines[0] === undefined || table.bands === undefined
        ? undefined
        : unresolvedGroupLabel(label.lines[0], grouped.flatMap((row) => row.lines), table.bands);
      if (label !== undefined && columns !== undefined) {
        warnings.push({
          code: "LAYOUT_DEGRADED",
          message: `Kept "${label.lines[0]?.text.trim()}" (${label.lineIds[0] ?? label.id}) out of the table below it: it is centred over ${columns} of the table's columns, but no bold header marks it as a group label.`,
          pageNumber: label.pageNumber,
        });
      }
      elements.push(element);
      index += grouped.length;
      continue;
    }

    const length = paragraphLength(candidates, index, opensBlock, gutter);
    elements.push(elementForCandidate(mergeCandidates(candidates.slice(index, index + length)), bodySize, headingSizes));
    index += length;
  }

  return elements;
}

function figureElements(page: LoadedPage): DocumentElement[] {
  return (page.blocks ?? [])
    .filter((block): block is Extract<LayoutBlock, { kind: "image" }> => block.kind === "image")
    .map((block) => ({
      id: block.id,
      kind: "figure" as const,
      assetId: block.assetId,
      ...(block.alt === undefined ? {} : { alt: block.alt }),
      provenance: {
        pageNumber: page.pageNumber,
        box: { x: block.x, y: block.y, width: block.width, height: block.height },
        sourceIds: [block.id],
      },
    }));
}

function furnitureElement(candidate: Candidate, furniture: Furniture): PageHeaderElement | PageFooterElement {
  const runs = inlineFromLines(candidate.lines);
  return {
    id: candidate.id,
    kind: furniture.kind,
    text: textOf(runs),
    runs,
    evidence: furniture.evidence,
    provenance: provenance([candidate]),
  };
}

function marginElement(candidate: Candidate): ParagraphElement {
  const runs = inlineFromLines(candidate.lines);
  return { id: candidate.id, kind: "paragraph", text: textOf(runs), runs, provenance: provenance([candidate]) };
}

function isFurniture(element: DocumentElement): element is PageHeaderElement | PageFooterElement {
  return element.kind === "page-header" || element.kind === "page-footer";
}

interface Tail {
  readonly elements: DocumentElement[];
  readonly elementIndex: number;
  readonly page: PageFrame;
  readonly box: LayoutBox;
  readonly table?: TableTraits;
  readonly suspectBelow?: Candidate;
  readonly label?: string;
}

function sourceLine(document: LoadedDocument, segment: Omit<ElementProvenance, "continuations"> | undefined, end: 0 | -1): TextLine | undefined {
  const id = segment?.lineIds?.at(end);
  const match = id === undefined ? null : /^p(\d+)-line-(\d+)$/u.exec(id);
  if (match !== null) return document.pages.find((page) => page.pageNumber === Number(match[1]))?.lines?.[Number(match[2]) - 1];
  const block = document.pages.find((page) => page.pageNumber === segment?.pageNumber)?.blocks
    ?.find((candidate) => candidate.id === segment?.sourceIds.at(end));
  return block?.kind === "text" ? block.lines.at(end) : undefined;
}

function isBodyText(element: DocumentElement): boolean {
  return element.kind !== "figure" && element.kind !== "page-break" && !isFurniture(element);
}

function continuationRows(table: TableElement, continuation: TableContinuation): TableElement | undefined {
  return appendTableRows(table, {
    rows: continuation.grid.rows,
    ...(continuation.grid.spans === undefined ? {} : { spans: continuation.grid.spans }),
    rowProvenance: continuation.rows.flatMap(rowSegments),
    sourceText: continuation.consumed.flatMap((candidate) => candidate.lines.map((line) => line.text)).join("\n"),
  }, provenance(continuation.consumed));
}

export function analyzeDocument(document: LoadedDocument, onPage: (pageNumber: number) => void = () => {}): DeterministicAnalysis {
  if (document.pages.every((page) => page.layout !== undefined)) {
    for (const page of document.pages) onPage(page.pageNumber);
    return {
      document: {
        pages: document.pages.map((page) => ({ pageNumber: page.pageNumber, width: page.width, height: page.height, elements: page.layout ?? [], ...(page.evidence === undefined ? {} : { evidence: page.evidence }) })),
        ...(document.sourceDigest === undefined ? {} : { sourceDigest: document.sourceDigest }),
        ...(document.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: document.physicalSourceDigest }),
        ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
      },
      warnings: document.conversionWarnings ?? [],
    };
  }
  const warnings: ConversionWarning[] = [...(document.conversionWarnings ?? [])];
  const sources = document.pages.map((page) => {
    const found = candidatesFor(page);
    return {
      page,
      source: found.source,
      candidates: found.candidates.filter((candidate) => !isRotated(candidate)),
      margin: found.candidates.filter(isRotated),
    };
  });
  const { confirmed: furniture, suspected } = detectFurniture(sources.filter(({ page }) => page.layout === undefined).map(({ page, candidates, source }) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    candidates: source === "text" ? [] : candidates,
  })));
  const pages: LayoutPage[] = [];
  const nativePages = new Set<number>();
  const headingSizes: HeadingSizes = new Map();
  let tail: Tail | undefined;
  for (const [pageIndex, { page, margin, ...sourceCandidates }] of sources.entries()) {
    if (page.layout !== undefined) {
      nativePages.add(page.pageNumber);
      pages.push({
        pageNumber: page.pageNumber, width: page.width, height: page.height,
        elements: page.layout,
        ...(page.evidence === undefined ? {} : { evidence: page.evidence }),
      });
      onPage(page.pageNumber);
      tail = undefined;
      continue;
    }
    const frame: PageFrame = { pageNumber: page.pageNumber, width: page.width, height: page.height };
    const pageFurniture = sourceCandidates.candidates.flatMap((candidate) => {
      const found = furniture.get(candidate);
      return found === undefined ? [] : [furnitureElement(candidate, found)];
    });
    const furnitureIds = new Set(pageFurniture.map((element) => element.id));
    const acceptTable = (group: TableGroup): boolean =>
      (group.rule === "equal-width" || positioned(frame)) && looksLikeTableGroup(group.candidates) &&
      !group.candidates.some((candidate) => suspected.has(candidate));

    const tailElement = tail === undefined ? undefined : tail.elements[tail.elementIndex];
    let continuedTable: { readonly table: TableElement; readonly box: LayoutBox; readonly consumed: ReadonlySet<Candidate> } | undefined;
    if (tail?.table !== undefined && tailElement?.kind === "table") {
      const continuation = takeTableContinuation(
        {
          ...tail.table,
          table: tailElement,
          page: tail.page,
          box: tail.box,
          ...(tail.suspectBelow === undefined ? {} : { suspectBelow: tail.suspectBelow }),
          ...(tail.label === undefined ? {} : { label: tail.label }),
        },
        frame,
        sourceCandidates.candidates.filter((candidate) => !furniture.has(candidate)),
        suspected,
      );
      if (continuation?.kind === "separate") warnings.push(continuation.warning);
      const table = continuation?.kind === "join" ? continuationRows(tailElement, continuation) : undefined;
      if (continuation?.kind === "join" && table !== undefined) {
        continuedTable = { table, box: unionBox(continuation.consumed.map((candidate) => candidate.box)), consumed: new Set(continuation.consumed) };
      }
    }

    const remainingCandidates = continuedTable === undefined
      ? sourceCandidates.candidates
      : sourceCandidates.candidates.filter((candidate) => !continuedTable.consumed.has(candidate));
    const gutter = clearGutter(remainingCandidates, page.width);
    const candidates = splitColumnCandidates(remainingCandidates, page.width, acceptTable, gutter);
    if (sourceCandidates.source !== "blocks") {
      warnings.push({
        code: "LAYOUT_DEGRADED",
        message: sourceCandidates.source === "lines"
          ? `Page ${page.pageNumber} has lines but no loader-provided layout blocks.`
          : `Page ${page.pageNumber} has no loader-provided layout blocks or lines.`,
        pageNumber: page.pageNumber,
      });
    }
    if (hasAmbiguousReadingOrder(candidates)) {
      warnings.push({
        code: "AMBIGUOUS_READING_ORDER",
        message: `Page ${page.pageNumber} has overlapping text blocks with no unambiguous order.`,
        pageNumber: page.pageNumber,
      });
    }
    const ordered = readingOrder(candidates, page.width, gutter?.boundary);
    const bodySize = bodyFontSize(sourceCandidates.candidates, tableRowIds(sourceCandidates.candidates));
    const body = ordered.filter((candidate) =>
      !furnitureIds.has(candidate.id) && !(candidate.sourceIds ?? []).some((id) => furnitureIds.has(id)));
    // `ordered` already carries the inferred column order. Sorting the resulting
    // elements by y/x here would quietly turn two columns back into row-major
    // order. Figures follow grounded text because they add no indexable text.
    const byPosition = (a: DocumentElement, b: DocumentElement) =>
      a.provenance.box.y - b.provenance.box.y || a.provenance.box.x - b.provenance.box.x;
    const traits = new Map<DocumentElement, TableTraits>();
    const elements: DocumentElement[] = [
      ...pageFurniture.filter((element) => element.kind === "page-header").sort(byPosition),
      ...analyzeTextCandidates(body, bodySize, acceptTable, traits, warnings, gutter?.boundary, headingSizes),
      ...figureElements(page),
      ...pageFurniture.filter((element) => element.kind === "page-footer").sort(byPosition),
    ];
    const bodyText = (): DocumentElement[] => elements.filter(isBodyText);
    const boxes = (texts: readonly DocumentElement[]) => texts.map((element) => element.provenance.box);

    let joinedBox: LayoutBox | undefined;
    if (tail !== undefined && continuedTable !== undefined) {
      tail.elements[tail.elementIndex] = continuedTable.table;
      joinedBox = continuedTable.box;
    } else if (tail !== undefined && tailElement?.kind === "paragraph") {
      const texts = bodyText();
      const first = texts[leadingBandLines(boxes(texts), page.height)];
      const lines = {
        end: sourceLine(document, provenanceSegments(tailElement.provenance).at(-1), -1),
        start: sourceLine(document, first?.provenance, 0),
      };
      if (first !== undefined && continuesParagraph(tailElement, tail, first, frame, lines)) {
        tail.elements[tail.elementIndex] = appendParagraph(tailElement, first);
        elements.splice(elements.indexOf(first), 1);
        joinedBox = first.provenance.box;
      }
    }

    const texts = bodyText();
    const last = texts[texts.length - 1 - trailingBandLines(boxes(texts), page.height)];
    const lastIndex = last === undefined ? -1 : elements.indexOf(last);
    if (!positioned(frame)) tail = undefined;
    else if (last !== undefined) {
      const table = traits.get(last);
      const bottom = last.provenance.box.y + last.provenance.box.height;
      const suspectBelow = sourceCandidates.candidates.find((candidate) => suspected.has(candidate) && candidate.box.y >= bottom);
      const caption = texts[texts.indexOf(last) - 1];
      const label = table === undefined || caption === undefined || !("text" in caption) ? undefined : tableLabel(caption.text);
      tail = {
        elements,
        elementIndex: lastIndex,
        page: frame,
        box: last.provenance.box,
        ...(table === undefined ? {} : { table }),
        ...(suspectBelow === undefined ? {} : { suspectBelow }),
        ...(label === undefined ? {} : { label }),
      };
    } else if (tail !== undefined && joinedBox !== undefined) {
      tail = { ...tail, page: frame, box: joinedBox };
    } else tail = undefined;

    const footer = elements.findIndex((element) => element.kind === "page-footer");
    elements.splice(footer === -1 ? elements.length : footer, 0, ...margin.map(marginElement));

    if (pageIndex + 1 < document.pages.length) {
      elements.push({
        id: `p${page.pageNumber}-page-break`,
        kind: "page-break",
        provenance: {
          pageNumber: page.pageNumber,
          box: { x: 0, y: page.height, width: page.width, height: 0 },
          sourceIds: [],
        },
      });
    }
    pages.push({ pageNumber: page.pageNumber, width: page.width, height: page.height, elements });
    onPage(page.pageNumber);
  }

  const levels = documentHeadingLevels(headingSizes);
  const leveled = pages.map((page) => ({
    ...page,
    elements: page.elements.map((element) => {
      const level = levels.get(element);
      return level === undefined || element.kind !== "heading" ? element : { ...element, level };
    }),
  }));
  const identified = new Map(withElementIds(leveled.filter((page) => !nativePages.has(page.pageNumber)))
    .map((page) => [page.pageNumber, page]));
  return {
    document: {
      pages: leveled.map((page) => identified.get(page.pageNumber) ?? page),
      ...(document.sourceDigest === undefined ? {} : { sourceDigest: document.sourceDigest }),
      ...(document.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: document.physicalSourceDigest }),
      ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
    },
    warnings,
  };
}

function retype(element: DocumentElement, annotation: LayoutAnnotation): DocumentElement | undefined {
  if (annotation.role === undefined || annotation.role === element.kind) {
    if (element.kind === "heading" && annotation.level !== undefined) {
      return { ...element, level: annotation.level };
    }
    return element;
  }
  if (element.kind !== "paragraph" && element.kind !== "heading" && element.kind !== "code") {
    return undefined;
  }

  const text = element.text;
  const runs = element.kind === "code" ? [{ text }] : element.runs;
  if (annotation.role === "paragraph") {
    return { id: element.id, kind: "paragraph", text, runs, provenance: element.provenance };
  }
  if (annotation.role === "heading") {
    return {
      id: element.id,
      kind: "heading",
      level: annotation.level ?? 2,
      text,
      runs,
      provenance: element.provenance,
    };
  }
  if (annotation.role === "code") {
    return { id: element.id, kind: "code", text, provenance: element.provenance };
  }
  if (annotation.role === "list") {
    return {
      id: element.id,
      kind: "list",
      ordered: false,
      items: [{ text, runs }],
      provenance: element.provenance,
    };
  }
  return undefined;
}

function mergeProvenance(elements: readonly DocumentElement[]): ElementProvenance {
  return withLineIds({
    pageNumber: elements[0]?.provenance.pageNumber ?? 0,
    box: unionBox(elements.map((element) => element.provenance.box)),
    sourceIds: elements.flatMap((element) => element.provenance.sourceIds),
  }, elements.flatMap((element) => element.provenance.lineIds ?? []));
}

function mergeGroup(elements: readonly DocumentElement[]): readonly DocumentElement[] | undefined {
  const first = elements[0];
  if (first === undefined || elements.length === 1) return elements;
  const provenance = mergeProvenance(elements);
  if (elements.every((element) => element.kind === "list")) {
    const lists = elements as readonly ListElement[];
    if (!lists.every((list) => list.ordered === lists[0]?.ordered)) return undefined;
    return [{
      id: first.id,
      kind: "list",
      ordered: lists[0]?.ordered ?? false,
      items: lists.flatMap((list) => list.items),
      provenance,
    }];
  }
  if (elements.every((element) => element.kind === "paragraph")) {
    const paragraphs = elements as readonly ParagraphElement[];
    const runs = paragraphs.flatMap((paragraph, index) => [
      ...(index === 0 ? [] : [{ text: "\n" }]),
      ...paragraph.runs,
    ]);
    return [{
      id: first.id,
      kind: "paragraph",
      text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      runs,
      provenance,
    }];
  }
  if (elements.every((element) => element.kind === "code")) {
    return [{
      id: first.id,
      kind: "code",
      text: elements.map((element) => (element as CodeElement).text).join("\n"),
      provenance,
    }];
  }
  if (elements.every((element) => element.kind === "table")) {
    const [base, ...rest] = elements as readonly TableElement[];
    const merged = rest.reduce<TableElement | undefined>(
      (table, next) => (table === undefined ? undefined : appendTableRows(table, next)),
      base,
    );
    return merged === undefined ? elements : [{ ...merged, provenance }];
  }
  return undefined;
}

interface ElementOwner {
  readonly elementId: string;
  readonly rowOffset: number;
}

function applyGroups(
  elements: readonly DocumentElement[],
  annotationById: ReadonlyMap<string, LayoutAnnotation>,
): { elements: DocumentElement[]; owners: ReadonlyMap<string, ElementOwner> } | { reason: string } {
  const positions = new Map<string, number[]>();
  elements.forEach((element, index) => {
    const group = annotationById.get(element.id)?.group;
    if (group === undefined) return;
    const members = positions.get(group) ?? [];
    members.push(index);
    positions.set(group, members);
  });
  for (const [group, members] of positions) {
    if (members.some((position, index) => index > 0 && position !== (members[index - 1] ?? 0) + 1)) {
      return { reason: `group ${group} is not contiguous` };
    }
  }

  const grouped: DocumentElement[] = [];
  const owners = new Map<string, ElementOwner>();
  for (let index = 0; index < elements.length; ) {
    const element = elements[index];
    if (element === undefined) break;
    const group = annotationById.get(element.id)?.group;
    if (group === undefined) {
      grouped.push(element);
      index += 1;
      continue;
    }
    const members: DocumentElement[] = [];
    while (index < elements.length) {
      const next = elements[index];
      if (next === undefined || annotationById.get(next.id)?.group !== group) break;
      members.push(next);
      index += 1;
    }
    const merged = mergeGroup(members);
    if (merged === undefined) return { reason: `group ${group} has incompatible roles` };
    const parent = merged[0];
    if (merged.length === 1 && parent !== undefined) {
      let rowOffset = 0;
      for (const member of members) {
        owners.set(member.id, { elementId: parent.id, rowOffset });
        if (member.kind === "table") rowOffset += member.rows.length;
      }
    }
    grouped.push(...merged);
  }
  return { elements: grouped, owners };
}

/** The document a layout analyzer sees: page furniture is not its to classify or order. */
export function withoutFurniture(document: LayoutDocument): LayoutDocument {
  if (!document.pages.some((page) => page.elements.some(isFurniture))) return document;
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements.filter((element) => !isFurniture(element)),
    })),
  };
}

function restoreFurniture(original: LayoutDocument, analyzed: LayoutDocument): LayoutDocument {
  return {
    ...analyzed,
    pages: analyzed.pages.map((page, index) => {
      const furniture = original.pages[index]?.elements.filter(isFurniture) ?? [];
      if (furniture.length === 0) return page;
      return {
        ...page,
        elements: [
          ...furniture.filter((element) => element.kind === "page-header"),
          ...page.elements.filter((element) => element.kind !== "page-break"),
          ...furniture.filter((element) => element.kind === "page-footer"),
          ...page.elements.filter((element) => element.kind === "page-break"),
        ],
      };
    }),
  };
}

function forContinuedElements(document: LayoutDocument, annotations: readonly LayoutAnnotation[]): readonly LayoutAnnotation[] {
  const continued = new Map(document.pages.flatMap((page) => page.elements)
    .filter((element) => element.provenance.continuations !== undefined)
    .map((element) => [element.id, element.kind]));
  if (continued.size === 0) return annotations;
  return annotations.map((annotation) => {
    const kind = continued.get(annotation.id);
    if (kind === undefined) return annotation;
    const { group: _group, role, ...rest } = annotation;
    return role === undefined || role === kind ? { ...rest, ...(role === undefined ? {} : { role }) } : rest;
  });
}

function keepContinuedLast(original: readonly DocumentElement[], ordered: readonly DocumentElement[]): DocumentElement[] {
  const index = original.findIndex((element) => element.provenance.continuations !== undefined);
  const id = original[index]?.id;
  const continued = ordered.find((element) => element.id === id);
  if (continued === undefined) return [...ordered];
  const after = new Set(original.slice(index + 1).map((element) => element.id));
  const rest = ordered.filter((element) => element !== continued);
  return [...rest.filter((element) => !after.has(element.id)), continued, ...rest.filter((element) => after.has(element.id))];
}

/**
 * Validate analyzer ids and order before applying any suggestion. Annotations
 * naming page furniture are ignored, and furniture keeps its slot. A table or
 * paragraph that continues onto the next page stays last in its page's text, and
 * annotations that would retype or group it are ignored.
 */
export function applyLayoutAnnotations(
  document: LayoutDocument,
  suggested: readonly LayoutAnnotation[],
): { document: LayoutDocument; valid: boolean; reason?: string } {
  const annotations = forContinuedElements(document, suggested);
  const body = withoutFurniture(document);
  if (body === document) return applyToBody(document, annotations);
  const furnitureIds = new Set(document.pages.flatMap((page) => page.elements.filter(isFurniture).map((element) => element.id)));
  const applied = applyToBody(body, annotations.filter((annotation) => !furnitureIds.has(annotation.id)));
  return applied.valid
    ? { document: restoreFurniture(document, applied.document), valid: true }
    : { ...applied, document };
}

function applyToBody(
  document: LayoutDocument,
  annotations: readonly LayoutAnnotation[],
): { document: LayoutDocument; valid: boolean; reason?: string } {
  const elements = document.pages.flatMap((page) => page.elements);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  for (const annotation of annotations) {
    if (!byId.has(annotation.id)) {
      return { document, valid: false, reason: `unknown element id ${annotation.id}` };
    }
    if (seen.has(annotation.id)) {
      return { document, valid: false, reason: `duplicate element id ${annotation.id}` };
    }
    const level: unknown = annotation.level;
    if (level !== undefined && !(Number.isInteger(level) && (level as number) >= 1 && (level as number) <= 6)) {
      return { document, valid: false, reason: `heading level ${String(level)} for ${annotation.id} must be an integer from 1 to 6` };
    }
    seen.add(annotation.id);
  }

  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const pages: LayoutPage[] = [];
  const owners = new Map<string, ElementOwner>();
  for (const page of document.pages) {
    const transformed: DocumentElement[] = [];
    for (const element of page.elements) {
      const annotation = annotationById.get(element.id);
      const next = annotation === undefined ? element : retype(element, annotation);
      if (next === undefined) {
        return {
          document,
          valid: false,
          reason: `role ${annotation?.role ?? "unknown"} is incompatible with ${element.id}`,
        };
      }
      transformed.push(next);
    }

    const ordered = transformed.filter((element) => annotationById.get(element.id)?.order !== undefined);
    if (ordered.length > 0) {
      if (ordered.length !== transformed.length) {
        return { document, valid: false, reason: `page ${page.pageNumber} has a partial order` };
      }
      const positions = transformed.map((element) => annotationById.get(element.id)?.order);
      const expected = transformed.map((_element, index) => index);
      if (
        positions.some((position) => position === undefined) ||
        [...(positions as number[])].sort((a, b) => a - b).some((value, index) => value !== expected[index])
      ) {
        return { document, valid: false, reason: `page ${page.pageNumber} order is not a permutation` };
      }
      transformed.sort(
        (a, b) =>
          (annotationById.get(a.id)?.order ?? 0) - (annotationById.get(b.id)?.order ?? 0),
      );
    }
    const grouped = applyGroups(keepContinuedLast(page.elements, transformed), annotationById);
    if ("reason" in grouped) {
      return { document, valid: false, reason: grouped.reason };
    }
    for (const [id, owner] of grouped.owners) owners.set(id, owner);
    pages.push({ ...page, elements: grouped.elements });
  }
  return {
    document: {
      ...document,
      pages: pages.map((page) => ({
        ...page,
        ...(page.evidence === undefined ? {} : { evidence: page.evidence.map((source) => {
          const owner = owners.get(source.elementId);
          return owner === undefined ? source : {
            ...source,
            elementId: owner.elementId,
            ...(source.granularity === "table-cell" ? { row: source.row + owner.rowOffset } : {}),
          };
        }) }),
      })),
    },
    valid: true,
  };
}
