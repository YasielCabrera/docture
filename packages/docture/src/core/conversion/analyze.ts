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
  fontSizes,
  HEADING_SIZE_RATIO,
  median,
  unionBox,
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
import { withElementIds } from "./element-ids.js";
import { detectFurniture, type Furniture } from "./furniture.js";
import { provenanceSegments } from "./provenance.js";
import { looksLikeTableGroup, tableGroupAt, tableGroupIds, tableLabel, unresolvedGroupLabel, type TableGroup } from "./table-grid.js";
import { appendTableRows } from "./tables.js";

export interface DeterministicAnalysis {
  readonly document: LayoutDocument;
  readonly warnings: readonly ConversionWarning[];
}

/**
 * Sort blocks by columns when the geometry clearly separates them. Blocks that
 * span most of the page remain in vertical order and naturally split columns.
 */
function readingOrder(candidates: readonly Candidate[], pageWidth: number): Candidate[] {
  const narrow = candidates.filter((candidate) => candidate.box.width < pageWidth * 0.6);
  const left = narrow.filter((candidate) => candidate.box.x + candidate.box.width <= pageWidth * 0.56);
  const right = narrow.filter((candidate) => candidate.box.x >= pageWidth * 0.44);
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
  const columnBottom = Math.max(
    ...[...matchedLeft, ...matchedRight].map(
      (candidate) => candidate.box.y + candidate.box.height,
    ),
  );
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
        candidate.box.x < pageWidth * 0.44 &&
        candidate.box.x + candidate.box.width > pageWidth * 0.56,
    )
    .sort((a, b) => a.box.y - b.box.y);
  let top = columnTop;

  const appendBand = (include: (box: LayoutBox) => boolean): void => {
    const band = middle.filter((candidate) => remaining.has(candidate) && candidate.box.y >= top && include(candidate.box));
    for (const candidate of band.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)) {
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

function hasAmbiguousReadingOrder(candidates: readonly Candidate[]): boolean {
  for (const [index, candidate] of candidates.entries()) {
    for (const other of candidates.slice(index + 1)) {
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
      if (spanIndex > 0) runs.push({ text: " " });
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

const UNORDERED = /^\s*[•◦▪●*-]\s+/u;
const ORDERED = /^\s*\d+[.)]\s+/u;

function listKind(text: string): "ordered" | "unordered" | undefined {
  if (ORDERED.test(text)) return "ordered";
  if (UNORDERED.test(text)) return "unordered";
  return undefined;
}

function stripListMarker(text: string): string {
  return text.replace(ORDERED, "").replace(UNORDERED, "");
}

function originalListMarker(text: string): string | undefined {
  return ORDERED.exec(text)?.[0] ?? UNORDERED.exec(text)?.[0];
}

interface CandidateGap {
  readonly index: number;
  readonly boundary: number;
}

function columnGap(candidate: Candidate, pageWidth: number): CandidateGap | undefined {
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
  if (best === undefined || best.size < Math.max(24, pageWidth * 0.08)) return undefined;
  return { index: best.index, boundary: best.boundary };
}

function splitCandidate(candidate: Candidate, gap: CandidateGap): Candidate[] {
  const line = candidate.lines[0];
  if (line === undefined) return [candidate];
  return [line.spans.slice(0, gap.index + 1), line.spans.slice(gap.index + 1)].flatMap(
    (spans, index) => {
      if (spans.length === 0) return [];
      const splitLine: TextLine = {
        y: line.y,
        height: line.height,
        text: spans.map((span) => span.text).join(" "),
        spans,
      };
      return [{
        ...candidate,
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
 * repeated wide gutter is column evidence unless typography marks the same rows
 * as a table. Splitting here gives the reading-order pass real column blocks.
 */
function splitColumnCandidates(
  candidates: readonly Candidate[],
  pageWidth: number,
  acceptTable: (group: TableGroup) => boolean,
): Candidate[] {
  const bandTables = tableGroupIds(candidates, (group) => group.rule === "bands" && acceptTable(group));
  const output: Candidate[] = [];
  for (let index = 0; index < candidates.length; ) {
    const candidate = candidates[index];
    if (candidate === undefined) break;
    const firstGap = columnGap(candidate, pageWidth);
    if (firstGap === undefined) {
      output.push(candidate);
      index += 1;
      continue;
    }

    const group: { candidate: Candidate; gap: CandidateGap }[] = [{ candidate, gap: firstGap }];
    for (let cursor = index + 1; cursor < candidates.length; cursor += 1) {
      const next = candidates[cursor];
      if (next === undefined) break;
      const gap = columnGap(next, pageWidth);
      if (
        gap === undefined ||
        Math.abs(gap.boundary - firstGap.boundary) > pageWidth * 0.08
      ) {
        break;
      }
      group.push({ candidate: next, gap });
    }

    if (group.length >= 2) {
      const splittableLines = group.filter((item) => !bandTables.has(item.candidate.id));
      if (looksLikeTableGroup(group.map((item) => item.candidate)) || splittableLines.length < 2) {
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

function elementForCandidate(
  candidate: Candidate,
  bodySize: number,
): HeadingElement | ParagraphElement | CodeElement {
  const runs = inlineFromLines(candidate.lines);
  const text = textOf(runs);
  const spans = allSpans(candidate);
  const sizes = fontSizes(candidate);
  const size = median(sizes);
  const mostlyBold = spans.length > 0 && spans.filter((span) => span.style?.bold === true).length >= spans.length / 2;
  const mostlyMono = spans.length > 0 && spans.filter((span) => span.style?.monospace === true).length >= spans.length / 2;
  const short = text.trim().length <= 120 && !text.includes("\n");
  const isHeading =
    candidate.role === "heading" ||
    (size > 0 && bodySize > 0 && size >= bodySize * HEADING_SIZE_RATIO && short) ||
    (mostlyBold && short && size >= bodySize);

  if (isHeading) {
    const level =
      candidate.level !== undefined && candidate.level >= 1 && candidate.level <= 6
        ? (candidate.level as HeadingElement["level"])
        : headingLevel(size, bodySize);
    return {
      id: candidate.id,
      kind: "heading",
      level,
      text,
      runs,
      provenance: provenance([candidate]),
    };
  }

  if (candidate.role === "code" || mostlyMono) {
    return {
      id: candidate.id,
      kind: "code",
      text,
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
): DocumentElement[] {
  const elements: DocumentElement[] = [];

  for (let index = 0; index < candidates.length; ) {
    const candidate = candidates[index];
    if (candidate === undefined) break;
    const rawText = candidate.lines.map((line) => line.text).join("\n");
    const kind = listKind(rawText);

    if (kind !== undefined || candidate.role === "list-item") {
      const grouped: Candidate[] = [];
      const items: { text: string; runs: readonly InlineText[]; marker?: string }[] = [];
      for (let cursor = index; cursor < candidates.length; cursor += 1) {
        const next = candidates[cursor];
        if (next === undefined) break;
        const nextText = next.lines.map((line) => line.text).join("\n");
        const nextKind = listKind(nextText);
        if (next.role !== "list-item" && (nextKind === undefined || nextKind !== kind)) break;
        grouped.push(next);
        const text = stripListMarker(nextText);
        const marker = originalListMarker(nextText);
        items.push({ text, runs: [{ text }], ...(marker === undefined ? {} : { marker }) });
      }
      const element: ListElement = {
        id: grouped[0]?.id ?? candidate.id,
        kind: "list",
        ordered: kind === "ordered",
        items,
        provenance: provenance(grouped),
      };
      elements.push(element);
      index += grouped.length;
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

    elements.push(elementForCandidate(candidate, bodySize));
    index += 1;
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

export function analyzeDocument(document: LoadedDocument): DeterministicAnalysis {
  const warnings: ConversionWarning[] = [];
  const sources = document.pages.map((page) => ({ page, ...candidatesFor(page) }));
  const { confirmed: furniture, suspected } = detectFurniture(sources.map(({ page, candidates, source }) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    candidates: source === "text" ? [] : candidates,
  })));
  const pages: { pageNumber: number; width: number; height: number; elements: DocumentElement[] }[] = [];
  let tail: Tail | undefined;
  for (const [pageIndex, { page, ...sourceCandidates }] of sources.entries()) {
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

    const candidates = splitColumnCandidates(
      continuedTable === undefined
        ? sourceCandidates.candidates
        : sourceCandidates.candidates.filter((candidate) => !continuedTable.consumed.has(candidate)),
      page.width,
      acceptTable,
    );
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
    const ordered = readingOrder(candidates, page.width);
    const bodySize = bodyFontSize(sourceCandidates.candidates);
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
      ...analyzeTextCandidates(body, bodySize, acceptTable, traits, warnings),
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
  }

  return {
    document: {
      pages: withElementIds(pages),
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

function applyGroups(
  elements: readonly DocumentElement[],
  annotationById: ReadonlyMap<string, LayoutAnnotation>,
): { elements?: DocumentElement[]; reason?: string } {
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
    grouped.push(...merged);
  }
  return { elements: grouped };
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
    seen.add(annotation.id);
  }

  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const pages: LayoutPage[] = [];
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
    if (grouped.elements === undefined) {
      return { document, valid: false, reason: grouped.reason ?? "invalid grouping" };
    }
    pages.push({ ...page, elements: grouped.elements });
  }
  return { document: { ...document, pages }, valid: true };
}
