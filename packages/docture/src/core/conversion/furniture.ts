import type { FurnitureEvidence } from "../domain/conversion.js";
import type { LayoutBox } from "../domain/geometry.js";
import { bodyFontSize, fontSizes, HEADING_SIZE_RATIO, median, type Candidate } from "./candidates.js";
import { continuedTableLabel, looksLikeTableGroup, tableGroupIds } from "./table-grid.js";

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
const OUTER_BAND = 0.15;
const OUTER_TOP_TOLERANCE = 0.01;
const OUTER_LEFT_TOLERANCE = 0.02;

interface Occurrence {
  readonly candidate: Candidate;
  readonly pageNumber: number;
  readonly kind: FurnitureKind;
  readonly text: string;
  readonly digits: readonly number[];
  readonly top: number;
  readonly left: number;
  readonly tableRow: boolean;
}

export interface FurnitureFindings {
  readonly confirmed: ReadonlyMap<Candidate, Furniture>;
  readonly suspected: ReadonlyMap<Candidate, readonly number[]>;
}

function outerBandOf(box: LayoutBox, pageHeight: number): FurnitureKind | undefined {
  if (bandOf(box, pageHeight) !== undefined) return undefined;
  if (box.y >= 0 && box.y + box.height <= pageHeight * OUTER_BAND) return "page-header";
  if (box.y >= pageHeight * (1 - OUTER_BAND)) return "page-footer";
  return undefined;
}

function isolated(candidate: Candidate, kind: FurnitureKind, candidates: readonly Candidate[]): boolean {
  const { y, height } = candidate.box;
  const lineHeight = candidate.lines[0]?.height || height;
  return candidates.every((other) => {
    if (other === candidate) return true;
    const gap = kind === "page-header" ? other.box.y - (y + height) : y - (other.box.y + other.box.height);
    const beyond = kind === "page-header" ? other.box.y + other.box.height <= y : other.box.y >= y + height;
    return beyond || gap >= lineHeight;
  });
}

function bold(candidate: Candidate): boolean {
  const spans = candidate.lines.flatMap((line) => line.spans);
  return spans.length > 0 && spans.every((span) => span.style?.bold === true);
}

function pageNumberLike(text: string): boolean {
  return /\d/u.test(text) && !/[.!?]$/u.test(text) && (text.match(/\p{L}+/gu) ?? []).length <= 3;
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

function suspects(occurrences: readonly Occurrence[], confirmed: ReadonlyMap<Candidate, Furniture>): Map<Candidate, readonly number[]> {
  const byText = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.kind}\u0000${occurrence.text}`;
    byText.set(key, [...(byText.get(key) ?? []), occurrence]);
  }
  const found = new Map<Candidate, readonly number[]>();
  for (const group of byText.values()) {
    if (group.every((occurrence) => occurrence.tableRow)) continue;
    for (const occurrence of group) {
      const pages = group
        .filter((other) => other.pageNumber !== occurrence.pageNumber && Math.abs(other.top - occurrence.top) <= POSITION_TOLERANCE)
        .map((other) => other.pageNumber);
      if (pages.length > 0 && !confirmed.has(occurrence.candidate)) found.set(occurrence.candidate, [...new Set(pages)]);
    }
  }
  return found;
}

export function detectFurniture(pages: readonly FurniturePage[]): FurnitureFindings {
  const found = new Map<Candidate, Furniture>();
  const occurrences: Occurrence[] = [];
  const outer: Occurrence[] = [];
  for (const page of pages) {
    if (page.width <= 0 || page.height <= 0) continue;
    const bodySize = bodyFontSize(page.candidates);
    const tableRows = tableRowIds(page.candidates);
    for (const candidate of page.candidates) {
      if (!candidate.lines.some((line) => line.spans.length > 0)) continue;
      const band = bandOf(candidate.box, page.height);
      const outerBand = band === undefined ? outerBandOf(candidate.box, page.height) : undefined;
      if (band === undefined && outerBand === undefined) continue;
      if (band !== undefined && (candidate.role === "header" || candidate.role === "footer")) {
        found.set(candidate, { kind: candidate.role === "header" ? "page-header" : "page-footer", evidence: "tagged" });
        continue;
      }
      const text = textOf(candidate);
      if (text.length === 0 || headingSized(candidate, bodySize) || continuedTableLabel(text) !== undefined) continue;
      const kind = band ?? outerBand;
      const outerEligible = outerBand === undefined ||
        (pageNumberLike(text) && !bold(candidate) && !tableRows.has(candidate.id) && isolated(candidate, outerBand, page.candidates));
      if (kind === undefined || !outerEligible) continue;
      (band === undefined ? outer : occurrences).push({
        tableRow: tableRows.has(candidate.id),
        candidate,
        pageNumber: page.pageNumber,
        kind,
        text,
        digits: (text.match(/\d+/gu) ?? []).map(Number),
        top: candidate.box.y / page.height,
        left: candidate.box.x / page.width,
      });
    }
  }

  const all = pages.map((page) => page.pageNumber);
  const groups = [all, all.filter((n) => n % 2 === 1), all.filter((n) => n % 2 === 0)]
    .filter((group) => group.length >= MIN_PAGES)
    .map((group) => new Set(group));
  const outerKeys = repetitionKeys(outer).filter((key) => new Set(key.map((occurrence) => occurrence.text)).size === key.length);
  const keys = [
    ...repetitionKeys(occurrences.filter((occurrence) => !occurrence.tableRow)).map((key) => ({ key, top: POSITION_TOLERANCE, left: Number.POSITIVE_INFINITY })),
    ...outerKeys.map((key) => ({ key, top: OUTER_TOP_TOLERANCE, left: OUTER_LEFT_TOLERANCE })),
  ];
  for (const { key, top, left } of keys) {
    for (const group of groups) {
      const inGroup = key.filter((occurrence) => group.has(occurrence.pageNumber));
      const center = median(inGroup.map((occurrence) => occurrence.top));
      const indent = median(inGroup.map((occurrence) => occurrence.left));
      const aligned = inGroup.filter((occurrence) =>
        Math.abs(occurrence.top - center) <= top && Math.abs(occurrence.left - indent) <= left);
      const hits = new Set(aligned.map((occurrence) => occurrence.pageNumber)).size;
      if (hits < MIN_PAGES || hits < group.size * MIN_SHARE) continue;
      for (const occurrence of aligned) {
        if (!found.has(occurrence.candidate)) found.set(occurrence.candidate, { kind: occurrence.kind, evidence: "repeated" });
      }
    }
  }
  return { confirmed: found, suspected: suspects(occurrences, found) };
}
