/**
 * Chunks of converted documents for retrieval, each with the page, box, and source
 * ids behind its text.
 */

import { createHash } from "node:crypto";
import type {
  DocumentElement,
  HeadingElement,
  ProvenanceSegment,
  TableElement,
} from "../core/domain/conversion.js";
import { markdownBlock } from "../core/conversion/export.js";
import { mergeSegments, provenanceSegments } from "../core/conversion/provenance.js";
import { appendTableRows, sliceTableRows } from "../core/conversion/tables.js";

export interface ChunkBudget {
  /** `estimatedTokens` counts `ceil(characters / 4)`, an estimate rather than a tokenizer's count. */
  readonly unit: "characters" | "estimatedTokens";
  /**
   * A soft limit. A chunk exceeds it only when it holds a single unit larger than
   * the budget: one element, or one table row group with the header rows, plus the
   * heading path when `headingPath` is set.
   */
  readonly max: number;
}

export interface ChunkOptions {
  readonly budget: ChunkBudget;
  /**
   * Whole elements, or table pieces, repeated from the end of the previous chunk
   * when they fit the budget with the chunk's first new unit. Default 0.
   */
  readonly overlapElements?: number;
  /** Start each chunk with the headings it sits under, one per level, outermost first. Default `false`. */
  readonly headingPath?: boolean;
}

/** A conversion result, or a saved document read with `parseDoctureDocument`. */
export interface ChunkableDocument {
  readonly pages: readonly { readonly elements: readonly DocumentElement[] }[];
}

export interface DocumentChunk {
  /** Derived from the element ids, table row ranges, and options, so it is stable across runs. */
  readonly id: string;
  /** Markdown of the chunk's elements, separated by blank lines. */
  readonly text: string;
  /** Ids of the elements the text comes from, in document order. */
  readonly elementIds: readonly string[];
  /**
   * Where the text comes from, element by element. A table piece has one segment
   * per page for its rows. A table without `rowProvenance`, as in a saved version 1
   * document, cites every segment of the table in each piece. Repeated header rows
   * and heading paths add none.
   */
  readonly provenance: readonly ProvenanceSegment[];
}

interface Unit {
  readonly element: DocumentElement;
  readonly text: string;
  readonly rows?: readonly [number, number];
  readonly provenance: readonly ProvenanceSegment[];
  readonly headingPath: readonly HeadingElement[];
}

/** `ceil(characters / 4)`: the estimate behind the `estimatedTokens` budget unit. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function indivisibleRowRanges(table: TableElement): (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  let start = table.headerRows;
  for (let row = table.headerRows + 1; row <= table.rows.length; row += 1) {
    const joined = (table.spans ?? []).some((span) => span.row < row && span.row + span.rowSpan > row);
    if (joined && row < table.rows.length) continue;
    ranges.push([start, row]);
    start = row;
  }
  return ranges;
}

function tablePiece(table: TableElement, start: number, end: number): Unit["provenance"] {
  const rows = table.rowProvenance;
  const from = start === table.headerRows ? 0 : start;
  return rows === undefined ? provenanceSegments(table.provenance) : mergeSegments(rows.slice(from, end));
}

function tableUnits(table: TableElement, headingPath: readonly HeadingElement[], fits: (text: string) => boolean): Unit[] {
  const whole = markdownBlock(table);
  const ranges = indivisibleRowRanges(table);
  if (fits(whole) || ranges.length < 2) return [{ element: table, text: whole, provenance: provenanceSegments(table.provenance), headingPath }];
  const header = sliceTableRows(table, 0, table.headerRows);
  const render = (start: number, end: number): string => {
    const body = sliceTableRows(table, start, end);
    return markdownBlock(table.headerRows === 0 ? body : appendTableRows(header, body) ?? body);
  };
  const units: Unit[] = [];
  let index = 0;
  while (index < ranges.length) {
    const start = ranges[index]?.[0] ?? 0;
    let end = ranges[index]?.[1] ?? start;
    index += 1;
    while (index < ranges.length && fits(render(start, ranges[index]?.[1] ?? end))) {
      end = ranges[index]?.[1] ?? end;
      index += 1;
    }
    units.push({ element: table, text: render(start, end), rows: [start, end], provenance: tablePiece(table, start, end), headingPath });
  }
  return units;
}

function units(document: ChunkableDocument, fitsAfter: (path: readonly HeadingElement[]) => (text: string) => boolean): Unit[] {
  const result: Unit[] = [];
  let headingPath: HeadingElement[] = [];
  for (const element of document.pages.flatMap((page) => page.elements)) {
    if (element.kind === "table") {
      result.push(...tableUnits(element, headingPath, fitsAfter(headingPath)));
      continue;
    }
    const text = markdownBlock(element);
    if (text === "") continue;
    if (element.kind === "heading") headingPath = [...headingPath.filter((heading) => heading.level < element.level), element];
    result.push({ element, text, provenance: provenanceSegments(element.provenance), headingPath });
  }
  return result;
}

function checkOptions(options: ChunkOptions): void {
  const { budget, overlapElements = 0 } = options;
  if (budget.unit !== "characters" && budget.unit !== "estimatedTokens") {
    throw new RangeError('budget.unit must be "characters" or "estimatedTokens"');
  }
  if (!Number.isFinite(budget.max) || budget.max <= 0) throw new RangeError("budget.max must be a positive finite number");
  if (!Number.isInteger(overlapElements) || overlapElements < 0) {
    throw new RangeError("overlapElements must be a non-negative integer");
  }
}

/**
 * Split a converted document into retrieval chunks of whole elements. A heading
 * starts a new chunk, and a chunk closes before the element that would take it
 * over `budget`, so a heading that does not fit with the element after it is a
 * chunk of its own. A table larger than the budget splits between rows, never
 * inside a row or a row span, and every piece repeats the header rows. A chunk
 * exceeds the budget only when it holds one unit, an element or a table row
 * group, that is larger than the budget on its own. Figures, page breaks, and
 * running headers and footers carry no chunk text. Body text appears in one chunk
 * only, unless `overlapElements` asks for repeats; repeated table header rows and
 * the optional heading path are context added on top.
 *
 * @example
 * ```ts
 * import { DocumentConverter } from "docture";
 * import { chunkDocument } from "docture/chunk";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 *
 * const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderPdfJs());
 * const result = await converter.convert("report.pdf", { format: "markdown" });
 * for (const chunk of chunkDocument(result, { budget: { unit: "estimatedTokens", max: 500 }, headingPath: true })) {
 *   const [first] = chunk.provenance;
 *   console.log(chunk.id, first?.pageNumber, first?.box, chunk.text.slice(0, 60));
 * }
 * ```
 */
export function chunkDocument(document: ChunkableDocument, options: ChunkOptions): readonly DocumentChunk[] {
  checkOptions(options);
  const { budget, overlapElements = 0, headingPath = false } = options;
  const size = (text: string): number => (budget.unit === "characters" ? text.length : estimateTokens(text));
  const fits = (text: string): boolean => size(text) <= budget.max;
  const fitsAfter = (path: readonly HeadingElement[]) => (text: string): boolean =>
    fits([...(headingPath ? path.map((heading) => markdownBlock(heading)) : []), text].join("\n\n"));
  const textOf = (members: readonly Unit[], fresh: number): string => {
    const first = members[members.length - fresh];
    const present = new Set(members.map((member) => member.element.id));
    const prefix = headingPath && first !== undefined
      ? first.headingPath.filter((heading) => !present.has(heading.id)).map((heading) => markdownBlock(heading))
      : [];
    return [...prefix, ...members.map((member) => member.text)].join("\n\n");
  };

  const chunks: DocumentChunk[] = [];
  let members: Unit[] = [];
  let fresh = 0;
  const close = (): void => {
    if (fresh === 0) return;
    const elementIds = [...new Set(members.map((member) => member.element.id))];
    const key = JSON.stringify([
      members.map((member) => [member.element.id, ...(member.rows ?? [])]),
      [budget.unit, budget.max],
      overlapElements,
      headingPath,
    ]);
    chunks.push({
      id: `chunk-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
      text: textOf(members, fresh),
      elementIds,
      provenance: members.flatMap((member) => member.provenance),
    });
    members = overlapElements === 0 ? [] : members.slice(-overlapElements);
    fresh = 0;
  };

  for (const unit of units(document, fitsAfter)) {
    const added = members.slice(members.length - fresh);
    const opensSection = unit.element.kind === "heading" && added.some((member) => member.element.kind !== "heading");
    if (fresh > 0 && (opensSection || !fits(textOf([...members, unit], fresh + 1)))) close();
    while (fresh === 0 && members.length > 0 && !fits(textOf([...members, unit], 1))) members = members.slice(1);
    members.push(unit);
    fresh += 1;
  }
  close();
  return chunks;
}
