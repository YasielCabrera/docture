import type { FurnitureEvidence } from "../domain/conversion.js";
import type { LayoutBox } from "../domain/geometry.js";
import { bodyFontSize, fontSizes, HEADING_SIZE_RATIO, median, type Candidate } from "./candidates.js";
import { looksLikeTableGroup, tableGroupIds } from "./table-grid.js";

export interface FurniturePage {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  /** Positioned candidates only; pass none for a text-only page. */
  readonly candidates: readonly Candidate[];
}

export type FurnitureKind = "page-header" | "page-footer";

export interface Furniture {
  readonly kind: FurnitureKind;
  readonly evidence: FurnitureEvidence;
}

const BAND = 0.1;
const MIN_PAGES = 3;
const MIN_SHARE = 0.6;
const POSITION_TOLERANCE = 0.02;

interface Occurrence {
  readonly candidate: Candidate;
  readonly pageNumber: number;
  readonly kind: FurnitureKind;
  readonly text: string;
  readonly digits: readonly number[];
  readonly top: number;
}

/** Which furniture band a box lies wholly inside, if any. */
export function bandOf({ y, height }: LayoutBox, pageHeight: number): FurnitureKind | undefined {
  if (y >= 0 && y + height <= pageHeight * BAND) return "page-header";
  if (y >= pageHeight * (1 - BAND)) return "page-footer";
  return undefined;
}

function textOf(candidate: Candidate): string {
  return candidate.lines.map((line) => line.text).join(" ").trim().replace(/\s+/gu, " ");
}

function tableRowIds(candidates: readonly Candidate[]): ReadonlySet<string> {
  return tableGroupIds(
    [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x),
    (group) => looksLikeTableGroup(group.candidates),
  );
}

function headingSized(candidate: Candidate, bodySize: number): boolean {
  if (candidate.role === "heading") return true;
  const size = median(fontSizes(candidate));
  return size > 0 && size >= bodySize * HEADING_SIZE_RATIO;
}

function mostCommon(values: readonly number[]): { readonly value: number; readonly count: number } {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = { value: Number.NaN, count: 0 };
  for (const [value, count] of counts) if (count > best.count) best = { value, count };
  return best;
}

function pageTracking(occurrences: readonly Occurrence[]): readonly Occurrence[] {
  const width = occurrences[0]?.digits.length ?? 0;
  const sameWidth = occurrences.filter((occurrence) => occurrence.digits.length === width);
  const rules = Array.from({ length: width }, (_unused, position) => {
    const constant = mostCommon(sameWidth.map((occurrence) => occurrence.digits[position] ?? Number.NaN));
    const offset = mostCommon(sameWidth.map((occurrence) => (occurrence.digits[position] ?? Number.NaN) - occurrence.pageNumber));
    return constant.count >= offset.count
      ? (occurrence: Occurrence) => occurrence.digits[position] === constant.value
      : (occurrence: Occurrence) => (occurrence.digits[position] ?? Number.NaN) - occurrence.pageNumber === offset.value;
  });
  return sameWidth.filter((occurrence) => rules.every((rule) => rule(occurrence)));
}

function repetitionKeys(occurrences: readonly Occurrence[]): Occurrence[][] {
  const byPattern = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.kind}\u0000${occurrence.text.replace(/\d+/gu, "#")}`;
    byPattern.set(key, [...(byPattern.get(key) ?? []), occurrence]);
  }
  return [...byPattern.values()].flatMap((group) => {
    if (new Set(group.map((occurrence) => occurrence.text)).size === 1) return [group];
    const tracking = pageTracking(group);
    const byText = new Map<string, Occurrence[]>();
    for (const occurrence of group) {
      if (!tracking.includes(occurrence)) byText.set(occurrence.text, [...(byText.get(occurrence.text) ?? []), occurrence]);
    }
    return [...(tracking.length > 0 ? [[...tracking]] : []), ...byText.values()];
  });
}

/** The running headers and footers among the pages' candidates. */
export function detectFurniture(pages: readonly FurniturePage[]): ReadonlyMap<Candidate, Furniture> {
  const found = new Map<Candidate, Furniture>();
  const occurrences: Occurrence[] = [];
  for (const page of pages) {
    if (page.width <= 0 || page.height <= 0) continue;
    const bodySize = bodyFontSize(page.candidates);
    const tableRows = tableRowIds(page.candidates);
    for (const candidate of page.candidates) {
      if (!candidate.lines.some((line) => line.spans.length > 0)) continue;
      const band = bandOf(candidate.box, page.height);
      if (band === undefined) continue;
      if (candidate.role === "header" || candidate.role === "footer") {
        found.set(candidate, { kind: candidate.role === "header" ? "page-header" : "page-footer", evidence: "tagged" });
        continue;
      }
      const text = textOf(candidate);
      if (text.length === 0 || tableRows.has(candidate.id) || headingSized(candidate, bodySize)) continue;
      occurrences.push({
        candidate,
        pageNumber: page.pageNumber,
        kind: band,
        text,
        digits: (text.match(/\d+/gu) ?? []).map(Number),
        top: candidate.box.y / page.height,
      });
    }
  }

  const all = pages.map((page) => page.pageNumber);
  const groups = [all, all.filter((n) => n % 2 === 1), all.filter((n) => n % 2 === 0)]
    .filter((group) => group.length >= MIN_PAGES)
    .map((group) => new Set(group));
  for (const key of repetitionKeys(occurrences)) {
    for (const group of groups) {
      const inGroup = key.filter((occurrence) => group.has(occurrence.pageNumber));
      const center = median(inGroup.map((occurrence) => occurrence.top));
      const aligned = inGroup.filter((occurrence) => Math.abs(occurrence.top - center) <= POSITION_TOLERANCE);
      const hits = new Set(aligned.map((occurrence) => occurrence.pageNumber)).size;
      if (hits < MIN_PAGES || hits < group.size * MIN_SHARE) continue;
      for (const occurrence of aligned) {
        if (!found.has(occurrence.candidate)) found.set(occurrence.candidate, { kind: occurrence.kind, evidence: "repeated" });
      }
    }
  }
  return found;
}
