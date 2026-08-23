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
  ListElement,
  ParagraphElement,
  TableElement,
} from "../domain/conversion.js";
import type {
  LayoutBlock,
  LayoutBox,
  LoadedDocument,
  LoadedPage,
  TextLayoutBlock,
  TextLine,
  TextSpan,
} from "../domain/geometry.js";

export interface DeterministicAnalysis {
  readonly document: LayoutDocument;
  readonly warnings: readonly ConversionWarning[];
}

interface Candidate {
  readonly id: string;
  /** Loader ids retained when one visual line is split into column candidates. */
  readonly sourceIds?: readonly string[];
  readonly pageNumber: number;
  readonly box: LayoutBox;
  readonly lines: readonly TextLine[];
  readonly role?: TextLayoutBlock["role"];
  readonly level?: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function boxOfLines(lines: readonly TextLine[]): LayoutBox {
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

function unionBox(boxes: readonly LayoutBox[]): LayoutBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

function candidatesFor(page: LoadedPage): { candidates: Candidate[]; degraded: boolean } {
  const textBlocks = (page.blocks ?? []).filter(
    (block): block is TextLayoutBlock => block.kind === "text",
  );
  if (textBlocks.length > 0) {
    return {
      candidates: textBlocks.map((block) => ({
        id: block.id,
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
      degraded: false,
    };
  }

  return {
    candidates: (page.lines ?? []).map((line, index) => ({
      id: `p${page.pageNumber}-line-${index + 1}`,
      pageNumber: page.pageNumber,
      box: boxOfLines([line]),
      lines: [line],
    })),
    degraded: true,
  };
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

  const appendBand = (bottom: number): void => {
    const band = middle.filter(
      (candidate) =>
        remaining.has(candidate) && candidate.box.y >= top && candidate.box.y < bottom,
    );
    for (const candidate of band.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)) {
      ordered.push(candidate);
      remaining.delete(candidate);
    }
  };

  for (const block of spanning) {
    appendBand(block.box.y);
    ordered.push(block);
    remaining.delete(block);
    top = block.box.y + block.box.height;
  }
  appendBand(Number.POSITIVE_INFINITY);
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

function fontSizes(candidate: Candidate): number[] {
  return candidate.lines.flatMap((line) =>
    line.spans.flatMap((span) =>
      span.style?.fontSize === undefined ? [] : [span.style.fontSize],
    ),
  );
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

function provenance(candidates: readonly Candidate[]): ElementProvenance {
  const first = candidates[0];
  return {
    pageNumber: first?.pageNumber ?? 0,
    box: unionBox(candidates.map((candidate) => candidate.box)),
    sourceIds: candidates.flatMap((candidate) => candidate.sourceIds ?? [candidate.id]),
  };
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

function isTableCandidate(candidate: Candidate): boolean {
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

function compatibleTableRows(first: Candidate, next: Candidate): boolean {
  if (first.role === "table" && next.role === "table") return true;
  const a = first.lines[0]?.spans ?? [];
  const b = next.lines[0]?.spans ?? [];
  if (a.length !== b.length || a.length < 2) return false;
  const tolerance = Math.max(4, median([...a, ...b].map((span) => span.height)) * 1.25);
  return a.every((span, index) => Math.abs(span.x - (b[index]?.x ?? Number.POSITIVE_INFINITY)) <= tolerance);
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

function looksLikeTableGroup(candidates: readonly Candidate[]): boolean {
  if (candidates.some((candidate) => candidate.role === "table")) return true;
  if (candidates.length < 2) return false;
  const first = candidates[0]?.lines.flatMap((line) => line.spans) ?? [];
  const remaining = candidates.slice(1).flatMap((candidate) => candidate.lines.flatMap((line) => line.spans));
  const typographicHeader =
    first.length >= 2 &&
    first.every((span) => span.style?.bold === true) &&
    remaining.some((span) => span.style?.bold !== true);
  if (typographicHeader) return true;

  // Some text layers lose font weight. Three or more aligned rows of compact
  // cells are still strong table evidence; longer prose remains conservative.
  return (
    candidates.length >= 3 &&
    candidates.every((candidate) =>
      candidate.lines.every(
        (line) =>
          line.spans.length >= 2 &&
          line.spans.every((span) => span.text.trim().length <= 40),
      ),
    )
  );
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
): Candidate[] {
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
      if (looksLikeTableGroup(group.map((item) => item.candidate))) {
        output.push(...group.map((item) => item.candidate));
      } else {
        output.push(...group.flatMap((item) => splitCandidate(item.candidate, item.gap)));
      }
      index += group.length;
      continue;
    }
    output.push(candidate);
    index += 1;
  }
  return output;
}

function tableRows(candidates: readonly Candidate[]): readonly (readonly string[])[] {
  return candidates.flatMap((candidate) =>
    candidate.lines.map((line) => line.spans.map((span) => span.text.trim())),
  );
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
    (size > 0 && bodySize > 0 && size >= bodySize * 1.18 && short) ||
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

function analyzeTextCandidates(candidates: readonly Candidate[]): DocumentElement[] {
  const sizes = candidates.flatMap(fontSizes).filter((size) => size > 0);
  const bodySize = median(sizes) || 10;
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
        if (next.role !== "list-item" && nextKind !== kind) break;
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

    if (isTableCandidate(candidate)) {
      const grouped: Candidate[] = [candidate];
      for (let cursor = index + 1; cursor < candidates.length; cursor += 1) {
        const next = candidates[cursor];
        if (
          next === undefined ||
          !isTableCandidate(next) ||
          !compatibleTableRows(grouped[0] ?? candidate, next)
        ) {
          break;
        }
        grouped.push(next);
      }
      const rows = tableRows(grouped);
      const width = rows[0]?.length ?? 0;
      const consistent = rows.length >= 2 && width >= 2 && rows.every((row) => row.length === width);
      if (consistent && looksLikeTableGroup(grouped)) {
        const element: TableElement = {
          id: grouped[0]?.id ?? candidate.id,
          kind: "table",
          rows,
          headerRows: 1,
          sourceText: grouped.flatMap((item) => item.lines.map((value) => value.text)).join("\n"),
          provenance: provenance(grouped),
        };
        elements.push(element);
        index += grouped.length;
        continue;
      }
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

export function analyzeDocument(document: LoadedDocument): DeterministicAnalysis {
  const warnings: ConversionWarning[] = [];
  const pages: LayoutPage[] = document.pages.map((page, pageIndex) => {
    const sourceCandidates = candidatesFor(page);
    const candidates = splitColumnCandidates(sourceCandidates.candidates, page.width);
    const { degraded } = sourceCandidates;
    if (degraded) {
      warnings.push({
        code: "LAYOUT_DEGRADED",
        message: `Page ${page.pageNumber} has lines but no loader-provided layout blocks.`,
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
    // `ordered` already carries the inferred column order. Sorting the resulting
    // elements by y/x here would quietly turn two columns back into row-major
    // order. Figures follow grounded text because they add no indexable text.
    const elements = [...analyzeTextCandidates(ordered), ...figureElements(page)];
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
    return {
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      elements,
    };
  });

  return {
    document: {
      pages,
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
  return {
    pageNumber: elements[0]?.provenance.pageNumber ?? 0,
    box: unionBox(elements.map((element) => element.provenance.box)),
    sourceIds: elements.flatMap((element) => element.provenance.sourceIds),
  };
}

function mergeGroup(elements: readonly DocumentElement[]): DocumentElement | undefined {
  const first = elements[0];
  if (first === undefined || elements.length === 1) return first;
  const provenance = mergeProvenance(elements);
  if (elements.every((element) => element.kind === "list")) {
    const lists = elements as readonly ListElement[];
    if (!lists.every((list) => list.ordered === lists[0]?.ordered)) return undefined;
    return {
      id: first.id,
      kind: "list",
      ordered: lists[0]?.ordered ?? false,
      items: lists.flatMap((list) => list.items),
      provenance,
    };
  }
  if (elements.every((element) => element.kind === "paragraph")) {
    const paragraphs = elements as readonly ParagraphElement[];
    const runs = paragraphs.flatMap((paragraph, index) => [
      ...(index === 0 ? [] : [{ text: "\n" }]),
      ...paragraph.runs,
    ]);
    return {
      id: first.id,
      kind: "paragraph",
      text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      runs,
      provenance,
    };
  }
  if (elements.every((element) => element.kind === "code")) {
    return {
      id: first.id,
      kind: "code",
      text: elements.map((element) => (element as CodeElement).text).join("\n"),
      provenance,
    };
  }
  if (elements.every((element) => element.kind === "table")) {
    const tables = elements as readonly TableElement[];
    return {
      id: first.id,
      kind: "table",
      rows: tables.flatMap((table) => table.rows),
      headerRows: tables[0]?.headerRows ?? 0,
      sourceText: tables
        .flatMap((table) => (table.sourceText === undefined ? [] : [table.sourceText]))
        .join("\n"),
      provenance,
    };
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
    grouped.push(merged);
  }
  return { elements: grouped };
}

/** Validate analyzer ids and order before applying any suggestion. */
export function applyLayoutAnnotations(
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
    const grouped = applyGroups(transformed, annotationById);
    if (grouped.elements === undefined) {
      return { document, valid: false, reason: grouped.reason ?? "invalid grouping" };
    }
    pages.push({ ...page, elements: grouped.elements });
  }
  return { document: { ...document, pages }, valid: true };
}
