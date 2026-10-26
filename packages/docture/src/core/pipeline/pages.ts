import type { LoadedDocument } from "../domain/geometry.js";
import { PageSelectionError } from "./errors.js";
import { inferForm } from "./features.js";

export function requestedPageNumbers(
  pageCount: number,
  requested?: readonly number[],
  maxPages?: number,
): number[] {
  const limit = Math.max(0, Math.min(pageCount, Math.floor(maxPages ?? pageCount)));
  if (requested === undefined) return Array.from({ length: limit }, (_, index) => index + 1);
  const unique = [...new Set(requested)];
  const missing = unique.filter((page) => !Number.isInteger(page) || page < 1 || page > limit);
  if (unique.length === 0 || missing.length > 0) throw new PageSelectionError(missing, pageCount);
  return unique.sort((a, b) => a - b);
}

export function selectPages(document: LoadedDocument, pages: readonly number[]): LoadedDocument {
  const known = new Set(document.pages.map((page) => page.pageNumber));
  const missingPages = [...new Set(pages)].filter((number) => !known.has(number));
  if (pages.length === 0 || missingPages.length > 0) {
    throw new PageSelectionError(missingPages, document.pages.length);
  }
  const wanted = new Set(pages);
  const kept = document.pages.filter((page) => wanted.has(page.pageNumber));
  return {
    ...document,
    pages: kept,
    text: kept.map((page) => page.text).join("\f"),
    form: document.form === "mixed" ? inferForm(kept.map((page) => page.text.trim().length)) : document.form,
  };
}
