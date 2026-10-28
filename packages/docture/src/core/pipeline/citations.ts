import type { OutcomeCitation } from "../contracts/strategy.js";
import { sourceLines } from "../conversion/source-lines.js";
import type { LineSourceId, SourceLine } from "../domain/conversion.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { FieldCitation } from "../domain/result.js";

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

function citationFor(leaf: PresentLeaf, entry: OutcomeCitation | undefined, known: ReadonlyMap<string, SourceLine>): FieldCitation {
  const path = leaf.path.join(".");
  if (entry === undefined) return { path, status: "uncited", ids: [] };
  const ids = entry.ids.filter((id) => known.has(id));
  const [first, ...rest] = ids;
  if (entry.status === "verified" && first !== undefined && ids.length === entry.ids.length && sameLeaf(entry.value, leaf.value)) {
    return { path, status: "verified", ids: [first, ...rest] };
  }
  return { path, status: "cited-unverified", ids };
}

/**
 * One citation per present leaf of the validated `data`, and the loader lines they
 * name. A leaf without an entry, such as a schema default, is `uncited`; an entry
 * for a key the schema stripped is dropped; an ID the document does not have is
 * dropped and costs a `verified` entry its status.
 */
export function alignCitations(
  data: unknown,
  cited: readonly OutcomeCitation[],
  document: LoadedDocument,
): { readonly citations: FieldCitation[]; readonly citationSources: SourceLine[] } {
  const known = new Map(document.pages.flatMap((page) => sourceLines(page)).map((line) => [line.id, line]));
  const entries = new Map(cited.map((entry) => [pathKey(entry.path), entry]));
  const citations = presentLeaves(data).map((leaf) => citationFor(leaf, entries.get(pathKey(leaf.path)), known));
  const ids = [...new Set(citations.flatMap((citation) => citation.ids))].sort(byPageThenLine);
  return { citations, citationSources: ids.flatMap((id) => known.get(id) ?? []) };
}
