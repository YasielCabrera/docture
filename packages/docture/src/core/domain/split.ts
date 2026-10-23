/**
 * Cutting a bundle into documents.
 *
 * A scanned batch is routinely one PDF holding eleven unrelated things: two
 * invoices, a driver's licence, a contract. Extracting it as one document is
 * meaningless, so it has to be cut first — and the cut has to be reported, because
 * "which pages did you think were the invoice?" is the first question anyone asks
 * when a number looks wrong.
 */

/** One document found inside a bundle. */
export interface DocGroup {
  /** 1-based page numbers, ascending, in the original document. */
  readonly pages: readonly number[];
  /** The classification name this group was recognised as, or `"UNKNOWN"`. */
  readonly classification: string;
  /** 0–1, when the splitter reports one. */
  readonly confidence?: number;
}

/** The full cut. Groups are in page order and together cover every page once. */
export type DocGroups = readonly DocGroup[];

/**
 * A splitter's answer about one adjacent page pair — the unit of work behind
 * {@link SplittingStrategy.LAZY}.
 */
export interface SplitVerdict {
  /** Is the second page a continuation of the first page's document? */
  readonly belongsToSameDocument: boolean;
  readonly classificationPage1: string;
  /** Absent when there is no second page (the last window of an odd bundle). */
  readonly classificationPage2?: string;
  readonly confidence?: number;
}

/** The name used when a splitter cannot place a page. */
export const UNCLASSIFIED = "UNKNOWN";

/**
 * Adjacent windows over a page list — `[p1,p2], [p2,p3], …` for `size` 2.
 *
 * Overlapping on purpose: the question a lazy splitter answers is about the SEAM
 * between two pages, so every seam must appear in exactly one window. A document
 * with fewer pages than the window has no seams and yields no windows — the
 * single-document case is not a degenerate split, it is not a split at all.
 */
export function pageWindows<T>(pages: readonly T[], size = 2): T[][] {
  if (size < 2) throw new TypeError("pageWindows needs a window of at least 2.");
  const windows: T[][] = [];
  for (let i = 0; i + size <= pages.length; i += 1) {
    windows.push(pages.slice(i, i + size));
  }
  return windows;
}

/**
 * Fold pairwise verdicts into groups.
 *
 * `verdicts[i]` is the answer for the seam between page `i+1` and page `i+2`, so
 * `pageCount` pages produce `pageCount - 1` verdicts. Shared rather than
 * reimplemented per splitter: an image splitter and a text splitter disagree about
 * how to *judge* a seam and must not disagree about what a run of "same document"
 * answers MEANS.
 *
 * `pageCount` is passed rather than inferred so the result is guaranteed to cover
 * every page exactly once — a splitter that returned too few verdicts truncates the
 * last group instead of silently inventing a page that does not exist.
 */
export function aggregateDocGroups(
  verdicts: readonly SplitVerdict[],
  pageCount: number,
): DocGroup[] {
  if (pageCount <= 0) return [];
  if (pageCount === 1) {
    return [{ pages: [1], classification: verdicts[0]?.classificationPage1 ?? UNCLASSIFIED }];
  }

  const first = verdicts[0];
  if (first === undefined) {
    // No seams were judged. One document is the only honest answer.
    return [{ pages: range(1, pageCount), classification: UNCLASSIFIED }];
  }

  const groups: DocGroup[] = [];
  let pages: number[];
  let classification: string;

  if (first.belongsToSameDocument) {
    pages = [1, 2];
    classification = first.classificationPage1;
  } else {
    groups.push({ pages: [1], classification: first.classificationPage1 });
    pages = [2];
    classification = first.classificationPage2 ?? UNCLASSIFIED;
  }

  // `page` is the LEFT page of the seam under consideration, so the page whose fate
  // a verdict decides is always `page + 1`.
  let page = 2;
  for (const verdict of verdicts.slice(1)) {
    if (page + 1 > pageCount) break;
    if (verdict.belongsToSameDocument) {
      pages.push(page + 1);
    } else {
      groups.push({ pages, classification });
      pages = [page + 1];
      classification = verdict.classificationPage2 ?? UNCLASSIFIED;
    }
    page += 1;
  }

  // Pages past the last verdict belong to the group that was still open.
  for (let trailing = page + 1; trailing <= pageCount; trailing += 1) pages.push(trailing);

  groups.push({ pages, classification });
  return groups;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}
