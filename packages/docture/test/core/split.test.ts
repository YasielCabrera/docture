/**
 * The split primitives.
 *
 * `pageWindows` and `aggregateDocGroups` are shared by every splitter for one
 * reason: an image splitter and a text splitter are allowed to disagree about how to
 * judge a seam, and must not be able to disagree about what a run of "same document"
 * answers means. That makes the fold worth testing on its own.
 */

import { describe, expect, it, vi } from "vitest";
import {
  SplittingStrategy,
  UNCLASSIFIED,
  aggregateDocGroups,
  defineSplitter,
  pageWindows,
  runSplitter,
  silentLogger,
  type SplitContext,
  type SplitVerdict,
} from "../../src/core/index.js";
import { fakeSplitter, multiPageDoc } from "./fakes.js";

const ctx = (names: readonly string[] = ["invoice"]): SplitContext => ({
  classifications: names.map((name) => ({ name, description: name, schema: {} as never })),
  signal: new AbortController().signal,
  logger: silentLogger,
});

const seam = (
  same: boolean,
  page1 = "invoice",
  page2 = "invoice",
): SplitVerdict => ({
  belongsToSameDocument: same,
  classificationPage1: page1,
  classificationPage2: page2,
});

describe("pageWindows", () => {
  it("produces one window per seam, overlapping", () => {
    expect(pageWindows([1, 2, 3, 4])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  /** A single page has no seams. It is not a degenerate split; it is no split. */
  it("yields nothing for one page or none", () => {
    expect(pageWindows([1])).toEqual([]);
    expect(pageWindows([])).toEqual([]);
  });

  it("supports wider windows", () => {
    expect(pageWindows([1, 2, 3, 4], 3)).toEqual([
      [1, 2, 3],
      [2, 3, 4],
    ]);
  });

  it("refuses a window narrower than a seam", () => {
    expect(() => pageWindows([1, 2], 1)).toThrowError(TypeError);
  });
});

describe("aggregateDocGroups", () => {
  it("folds one run of yeses into one document", () => {
    expect(aggregateDocGroups([seam(true), seam(true)], 3)).toEqual([
      { pages: [1, 2, 3], classification: "invoice" },
    ]);
  });

  it("splits at a no", () => {
    expect(aggregateDocGroups([seam(true), seam(false, "invoice", "receipt")], 3)).toEqual([
      { pages: [1, 2], classification: "invoice" },
      { pages: [3], classification: "receipt" },
    ]);
  });

  it("handles a break at the very first seam", () => {
    expect(aggregateDocGroups([seam(false, "invoice", "receipt")], 2)).toEqual([
      { pages: [1], classification: "invoice" },
      { pages: [2], classification: "receipt" },
    ]);
  });

  it("alternates cleanly", () => {
    const groups = aggregateDocGroups(
      [seam(false, "a", "b"), seam(false, "b", "a"), seam(true, "a", "a")],
      4,
    );
    expect(groups).toEqual([
      { pages: [1], classification: "a" },
      { pages: [2], classification: "b" },
      { pages: [3, 4], classification: "a" },
    ]);
  });

  it("is one document when there is one page and no seam to judge", () => {
    expect(aggregateDocGroups([], 1)).toEqual([{ pages: [1], classification: UNCLASSIFIED }]);
  });

  it("is one document when no seam was judged at all", () => {
    expect(aggregateDocGroups([], 3)).toEqual([{ pages: [1, 2, 3], classification: UNCLASSIFIED }]);
  });

  /**
   * The failure that matters: a page that belongs to no group vanishes from the
   * extraction with nothing in the output to say it existed.
   */
  it("covers every page even when the splitter under-reports", () => {
    const groups = aggregateDocGroups([seam(true)], 5);
    expect(groups.flatMap((g) => g.pages)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never invents a page past the end", () => {
    const groups = aggregateDocGroups([seam(true), seam(false), seam(false)], 2);
    expect(groups.flatMap((g) => g.pages)).toEqual([1, 2]);
  });

  it("is empty for an empty document", () => {
    expect(aggregateDocGroups([], 0)).toEqual([]);
  });
});

describe("runSplitter", () => {
  const pages = multiPageDoc(["one", "two", "three"]).pages;

  it("never judges a seam for a single-page document", async () => {
    const onSeam = vi.fn();
    const groups = await runSplitter(
      fakeSplitter({ onSeam }),
      multiPageDoc(["only"]).pages,
      SplittingStrategy.LAZY,
      ctx(),
    );
    expect(onSeam).not.toHaveBeenCalled();
    expect(groups).toEqual([{ pages: [1], classification: UNCLASSIFIED }]);
  });

  it("judges every seam under LAZY", async () => {
    const seen: [number, number][] = [];
    await runSplitter(
      fakeSplitter({ onSeam: (a, b) => seen.push([a, b]) }),
      pages,
      SplittingStrategy.LAZY,
      ctx(),
    );
    expect(seen.sort()).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("uses splitEager under EAGER when the splitter has one", async () => {
    const onSeam = vi.fn();
    const groups = await runSplitter(
      fakeSplitter({ onSeam, eager: [{ pages: [1, 2, 3], classification: "invoice" }] }),
      pages,
      SplittingStrategy.EAGER,
      ctx(),
    );
    expect(onSeam).not.toHaveBeenCalled();
    expect(groups).toEqual([{ pages: [1, 2, 3], classification: "invoice" }]);
  });

  /**
   * The strategy is a cost preference. Losing it should not lose the answer.
   */
  it("degrades EAGER to LAZY rather than failing when there is no eager path", async () => {
    const onSeam = vi.fn();
    const groups = await runSplitter(
      fakeSplitter({ onSeam, seams: [true, true] }),
      pages,
      SplittingStrategy.EAGER,
      ctx(),
    );
    expect(onSeam).toHaveBeenCalledTimes(2);
    expect(groups).toEqual([{ pages: [1, 2, 3], classification: "invoice" }]);
  });

  it("respects a concurrency ceiling", async () => {
    let inFlight = 0;
    let peak = 0;
    const splitter = defineSplitter({
      name: "counting",
      async belongsToSameDocument() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return seam(true);
      },
    });

    await runSplitter(
      splitter,
      multiPageDoc(["a", "b", "c", "d", "e", "f"]).pages,
      SplittingStrategy.LAZY,
      ctx(),
      { concurrency: 2 },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("keeps verdicts in page order however they finish", async () => {
    const splitter = defineSplitter({
      name: "out-of-order",
      async belongsToSameDocument(first) {
        // The later seams settle first.
        await new Promise((resolve) => setTimeout(resolve, (4 - first.pageNumber) * 5));
        return seam(first.pageNumber !== 2, "invoice", "receipt");
      },
    });

    const groups = await runSplitter(
      splitter,
      multiPageDoc(["a", "b", "c", "d"]).pages,
      SplittingStrategy.LAZY,
      ctx(["invoice", "receipt"]),
    );
    expect(groups).toEqual([
      { pages: [1, 2], classification: "invoice" },
      { pages: [3, 4], classification: "receipt" },
    ]);
  });

  it("stops on an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSplitter(fakeSplitter(), pages, SplittingStrategy.LAZY, {
        ...ctx(),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("is empty for a document with no pages", async () => {
    expect(await runSplitter(fakeSplitter(), [], SplittingStrategy.EAGER, ctx())).toEqual([]);
  });
});
