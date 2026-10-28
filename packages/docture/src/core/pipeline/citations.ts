import type { OutcomeCitation } from "../contracts/strategy.js";
import { lineSourceId, sourceLines } from "../conversion/source-lines.js";
import type { LineSourceId, SourceLine } from "../domain/conversion.js";
import type { LoadedDocument, TextLine, TextSpan } from "../domain/geometry.js";
import { formatFieldPath } from "../domain/field-path.js";
import type { FieldCitation } from "../domain/result.js";
import type { EvidenceSourceId, SourceEvidence } from "../domain/evidence.js";
import { isLineSourceId } from "../conversion/source-lines.js";

export type FieldPath = readonly (string | number)[];

export interface PresentLeaf {
  readonly path: FieldPath;
  readonly value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function presentLeaves(value: unknown, path: FieldPath = []): PresentLeaf[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => presentLeaves(item, [...path, index]));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => presentLeaves(item, [...path, key]));
  return isPresent(value) ? [{ path, value }] : [];
}

/** A collision-free key for a path; `"a.b"` as one key differs from `a` then `b`. */
export function pathKey(path: FieldPath): string {
  return JSON.stringify(path);
}

function sameLeaf(raw: unknown, final: unknown): boolean {
  if (final instanceof Date && typeof raw === "string") {
    if (Number.isNaN(final.getTime())) return false;
    const iso = final.toISOString();
    return raw === iso || `${raw}T00:00:00.000Z` === iso;
  }
  return Object.is(raw, final);
}

function lineOrder(id: LineSourceId): [number, number] {
  const [, page, line] = /^p(\d+)-line-(\d+)$/u.exec(id) ?? [];
  return [Number(page), Number(line)];
}

function byPageThenLine(first: LineSourceId, second: LineSourceId): number {
  const [pageA, lineA] = lineOrder(first);
  const [pageB, lineB] = lineOrder(second);
  return pageA - pageB || lineA - lineB;
}

function usable(span: TextSpan | undefined): number | undefined {
  const confidence = span?.confidence;
  return typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : undefined;
}

function lowest(confidences: readonly (number | undefined)[]): number | undefined {
  if (confidences.length === 0 || confidences.some((confidence) => confidence === undefined)) return undefined;
  return Math.min(...(confidences as number[]));
}

/** A line's spans speak for its text only when the text is exactly the spans joined by single spaces. */
function attributedSpans(line: TextLine | undefined): readonly TextSpan[] | undefined {
  if (line === undefined || line.spans.length === 0) return undefined;
  return line.spans.map((span) => span.text).join(" ") === line.text ? line.spans : undefined;
}

function matchedConfidence(entry: OutcomeCitation, ids: readonly LineSourceId[], lines: ReadonlyMap<string, TextLine>): number | undefined {
  const spans = entry.spans ?? [];
  if (!ids.every((id) => spans.some((ref) => ref.line === id)) || !spans.every((ref) => ids.includes(ref.line))) return undefined;
  return lowest(spans.map((ref) => usable(attributedSpans(lines.get(ref.line))?.[ref.span])));
}

function citedConfidence(ids: readonly LineSourceId[], lines: ReadonlyMap<string, TextLine>): number | undefined {
  const spans = ids.map((id) => attributedSpans(lines.get(id)));
  return spans.some((line) => line === undefined) ? undefined : lowest(spans.flatMap((line) => line ?? []).map(usable));
}

function withConfidence<C extends FieldCitation>(citation: C, confidence: number | undefined): C {
  return confidence === undefined ? citation : { ...citation, minOcrConfidence: confidence };
}

function citationFor(leaf: PresentLeaf, entry: OutcomeCitation | undefined, lines: ReadonlyMap<string, TextLine>, known: ReadonlySet<string>): FieldCitation {
  const path = formatFieldPath(leaf.path);
  if (entry === undefined) return { path, status: "uncited", ids: [] };
  const ids = entry.ids.filter((id) => known.has(id));
  const confidenceIds = ids.filter(isLineSourceId);
  const lineOnly = ids.length === confidenceIds.length;
  const [first, ...rest] = ids;
  if (entry.status === "verified" && first !== undefined && ids.length === entry.ids.length && sameLeaf(entry.value, leaf.value)) {
    return withConfidence({ path, status: "verified", ids: [first, ...rest] }, lineOnly ? matchedConfidence(entry, confidenceIds, lines) : undefined);
  }
  return withConfidence({ path, status: "cited-unverified", ids }, lineOnly ? citedConfidence(confidenceIds, lines) : undefined);
}

export function alignCitations(
  data: unknown,
  cited: readonly OutcomeCitation[],
  document: LoadedDocument,
): { readonly citations: FieldCitation[]; readonly citationSources: SourceLine[]; readonly evidenceSources?: SourceEvidence[] } {
  const known = new Map(document.pages.flatMap((page) => sourceLines(page)).map((line) => [line.id, line]));
  const lines = new Map(document.pages.flatMap((page) =>
    (page.lines ?? []).map((line, index) => [lineSourceId(page.pageNumber, index), line] as const)));
  const entries = new Map(cited.map((entry) => [pathKey(entry.path), entry]));
  const native = document.pages.flatMap((page) => page.evidence ?? []);
  const knownIds = new Set<string>([...known.keys(), ...native.map((source) => source.id)]);
  const citations = presentLeaves(data).map((leaf) => citationFor(leaf, entries.get(pathKey(leaf.path)), lines, knownIds));
  const ids = new Set<EvidenceSourceId>(citations.flatMap((citation) => citation.ids));
  const lineIds = [...ids].filter(isLineSourceId).sort(byPageThenLine);
  return {
    citations, citationSources: lineIds.flatMap((id) => known.get(id) ?? []),
    ...(native.length === 0 ? {} : { evidenceSources: native.filter((source) => ids.has(source.id)) }),
  };
}
