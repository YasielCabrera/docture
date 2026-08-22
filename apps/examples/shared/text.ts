/**
 * Four text primitives every parser here needs. None of this is the lesson.
 */

import type { LoadedDocument } from "docture";

/** `"$1,308.47"` and `"1,308.47"` both become `1308.47`. `null` when unparseable. */
export function money(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[$€£\s,]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * `MM/DD/YYYY` and `MM/DD/YY` become `YYYY-MM-DD`.
 *
 * Two-digit years are read as 20xx. Every document here is post-2000, and guessing is
 * better than emitting a date a downstream consumer cannot parse at all.
 */
export function isoDate(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim());
  if (match === null) return null;
  const [, month, day, year] = match;
  if (month === undefined || day === undefined || year === undefined) return null;
  return `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Every line of the document, in page then reading order, trimmed and non-empty. */
export function lines(document: LoadedDocument, pages?: readonly number[]): string[] {
  const wanted = pages === undefined ? undefined : new Set(pages);
  const out: string[] = [];
  for (const page of document.pages) {
    if (wanted !== undefined && !wanted.has(page.pageNumber)) continue;
    // `lines` is the loader's positioned geometry; `text` is the fallback for a
    // text-only loader like `DocumentLoaderData`, which reports `geometry: false`.
    const source =
      page.lines === undefined ? page.text.split("\n").map((text) => ({ text })) : page.lines;
    for (const line of source) {
      const text = line.text.trim();
      if (text !== "") out.push(text);
    }
  }
  return out;
}

/** The first capture of the first line that matches. */
export function capture(source: readonly string[], pattern: RegExp): string | undefined {
  for (const line of source) {
    const match = pattern.exec(line);
    if (match !== null) return match[1];
  }
  return undefined;
}

/** Fail with a message that names the field, not just "undefined". */
export function required<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    throw new Error(`could not find "${field}" in this document`);
  }
  return value;
}
