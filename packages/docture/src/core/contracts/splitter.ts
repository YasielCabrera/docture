import type { DisposalScope } from "./disposal.js";
/**
 * The splitter contract.
 *
 * A splitter answers ONE question — "is page B a continuation of page A's
 * document?" — and core does the folding. That division is deliberate: an image
 * splitter and a text splitter genuinely disagree about how to judge a seam, and
 * must not be able to disagree about what a run of "yes" answers means. The fold
 * lives once, in {@link aggregateDocGroups}.
 *
 * ```ts
 * const splitter = defineSplitter({
 *   name: "heading-splitter",
 *   async belongsToSameDocument(a, b) {
 *     return {
 *       belongsToSameDocument: !/^INVOICE/m.test(b.text),
 *       classificationPage1: "invoice",
 *       classificationPage2: "invoice",
 *     };
 *   },
 * });
 * ```
 */

import type { DocumentFact } from "../domain/document.js";
import type { SplittingStrategy } from "../domain/enums.js";
import type { LoadedPage } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import {
  UNCLASSIFIED,
  aggregateDocGroups,
  type DocGroups,
  type SplitVerdict,
} from "../domain/split.js";
import { pageWindows } from "./page-windows.js";
import { SplitFailedError, type SplitCoverage } from "../pipeline/errors.js";
import type { Usage } from "../domain/result.js";
import type { Classification } from "./classifier.js";
import { positiveInteger } from "../pipeline/options.js";

export interface SplitContext {
  /** The kinds a page may be recognised as. Never empty when a splitter runs. */
  readonly classifications: readonly Classification[];
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /**
   * Report tokens spent. A splitter that calls a model should call this for every
   * request, so the cost of deciding where a bundle divides shows up next to the
   * cost of extracting it — splitting a 60-page scan is not free, and a cost report
   * that omits it is wrong rather than incomplete.
   */
  readonly recordUsage?: (usage: Partial<Usage>) => void;
  /** The source's file name, when it has one. Model telemetry may record it. */
  readonly documentLabel?: string;
}

export interface Splitter {
  /** Stable id. Appears in the split report. */
  readonly name: string;
  /**
   * Facts the DOCUMENT must have for this splitter to run — `RENDERABLE_PAGES` for
   * an image splitter, `TEXT_LAYER` for a text one. Checked before it is asked to
   * split, so a scanned bundle handed a text splitter fails at the seam it should:
   * wiring, not halfway through page 40.
   */
  readonly requires?: readonly DocumentFact[];
  /**
   * Judge one seam. This is the whole contract — `lazy` splitting is built from it,
   * and so is `eager` when {@link Splitter.splitEager} is absent.
   */
  belongsToSameDocument(
    first: LoadedPage,
    second: LoadedPage,
    ctx: SplitContext,
  ): Promise<SplitVerdict>;
  /**
   * Judge the whole bundle in one pass. Optional, and worth implementing only when
   * one request over everything beats `n-1` requests over the seams — which is
   * exactly what `EAGER` means.
   */
  splitEager?(pages: readonly LoadedPage[], ctx: SplitContext): Promise<DocGroups>;
  dispose?(scope?: DisposalScope): Promise<void>;
}

/** Identity helper, for symmetry with `defineLoader`. */
export function defineSplitter(splitter: Splitter): Splitter {
  return splitter;
}

export interface RunSplitterOptions {
  /** How many seams to judge at once under `LAZY`. Default 4. */
  readonly concurrency?: number;
}

/**
 * Run `splitter` over `pages` under `strategy` — the ONE place a
 * {@link SplittingStrategy} is interpreted.
 *
 * A single-page document is never "split": it is one group, with no seam judged and
 * no request made. `EAGER` without a `splitEager` implementation degrades to `LAZY`
 * rather than throwing, because the strategy is a performance preference and losing
 * it should not lose the answer.
 */
export async function runSplitter(
  splitter: Splitter,
  pages: readonly LoadedPage[],
  strategy: SplittingStrategy,
  ctx: SplitContext,
  options: RunSplitterOptions = {},
): Promise<DocGroups> {
  if (pages.length === 0) return [];
  if (pages.length === 1) {
    return [{ pages: [pages[0]?.pageNumber ?? 1], classification: UNCLASSIFIED }];
  }

  if (strategy === "eager" && splitter.splitEager !== undefined) {
    return coveringEveryPage(splitter.name, await splitter.splitEager(pages, ctx), pages);
  }

  const windows = pageWindows(pages, 2);
  const verdicts = await mapWithConcurrency(
    windows,
    Math.max(1, options.concurrency ?? 4),
    async (window, _index, signal) => {
      const [first, second] = window;
      if (first === undefined || second === undefined) {
        throw new TypeError("pageWindows produced an incomplete window.");
      }
      signal.throwIfAborted();
      return splitter.belongsToSameDocument(first, second, { ...ctx, signal });
    },
    ctx.signal,
  );

  return aggregateDocGroups(verdicts, pages.length).map((group) => ({
    ...group,
    pages: group.pages.map((position) => pages[position - 1]?.pageNumber ?? position),
  }));
}

function coveringEveryPage(name: string, groups: DocGroups, pages: readonly LoadedPage[]): DocGroups {
  const counts = new Map(pages.map((page) => [page.pageNumber, 0]));
  const unknown = new Set<number>();
  for (const page of groups.flatMap((group) => group.pages)) {
    const count = counts.get(page);
    if (count === undefined) unknown.add(page);
    else counts.set(page, count + 1);
  }
  const ascending = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);
  const coverage: SplitCoverage = {
    overlaps: ascending([...counts].filter(([, count]) => count > 1).map(([page]) => page)),
    missing: ascending([...counts].filter(([, count]) => count === 0).map(([page]) => page)),
    unknown: ascending(unknown),
  };
  const problems = [
    ...groups.flatMap((group, index) => group.pages.length === 0 ? [`group ${index + 1} (${group.classification}) has no pages`] : []),
    ...coverage.overlaps.map((page) => `page ${page} is in ${counts.get(page)} groups`),
    ...listed(coverage.missing, "in no group"),
    ...listed(coverage.unknown, "not in the bundle"),
  ];
  if (problems.length === 0) return groups;
  throw new SplitFailedError(`${name} must place every page in exactly one group; ${problems.join("; ")}`, [], coverage);
}

function listed(pages: readonly number[], state: string): string[] {
  if (pages.length === 0) return [];
  return [pages.length === 1 ? `page ${pages[0]} is ${state}` : `pages ${pages.join(", ")} are ${state}`];
}

/**
 * Bounded work in input order. A failure aborts siblings and drains active work.
 *
 * A 60-page bundle is 59 seams, and 59 simultaneous model calls is a rate-limit
 * error rather than a fast split.
 */
async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  fn: (item: In, index: number, signal: AbortSignal) => Promise<Out>,
  signal?: AbortSignal,
): Promise<Out[]> {
  positiveInteger("concurrency", limit);
  const results = new Array<Out>(items.length);
  const entries = items.entries();
  const controller = new AbortController();
  let failure: { readonly error: unknown } | undefined;
  const fail = (error: unknown): void => {
    failure ??= { error };
    controller.abort(error);
  };
  const onAbort = (): void => fail(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const entry = entries.next();
      if (entry.done) return;
      const [index, item] = entry.value;
      try {
        results[index] = await fn(item, index, controller.signal);
      } catch (error) {
        fail(error);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (failure !== undefined) throw failure.error;
    return results;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export { mapWithConcurrency };
export type { SplitVerdict };
