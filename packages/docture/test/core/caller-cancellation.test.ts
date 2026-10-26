import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, DocumentConverter } from "../../src/core/index.js";
import { doc, fakeLoader, fakeStrategy, PDF_BYTES } from "./fakes.js";

describe("caller cancellation", () => {
  for (const reaction of ["reject", "return"] as const) {
    it(`preserves the caller reason when a loader ${reaction}s after cancellation`, async () => {
      const controller = new AbortController();
      const reason = new Error("caller stopped loading");
      const loader = fakeLoader();
      const extractor = createExtractor({
        loaders: [{ ...loader, async load() {
          controller.abort(reason);
          if (reaction === "reject") throw reason;
          return doc("Invoice");
        } }],
      });
      const outcome = await extractor.classify(PDF_BYTES, [], { signal: controller.signal }).catch((error: unknown) => error);
      expect(outcome).toBe(reason);
    });

    it(`preserves the caller reason when a classifier ${reaction}s after cancellation`, async () => {
      const controller = new AbortController();
      const reason = new Error("caller stopped classifying");
      const extractor = createExtractor({
        loaders: [fakeLoader()],
        classifiers: [{ name: "cancelled", async classify() {
          controller.abort(reason);
          if (reaction === "reject") throw reason;
          return null;
        } }],
      });
      const outcome = await extractor.classify(PDF_BYTES, [], { signal: controller.signal }).catch((error: unknown) => error);
      expect(outcome).toBe(reason);
    });

    it(`preserves the caller reason when a strategy ${reaction}s after cancellation`, async () => {
      const controller = new AbortController();
      const reason = new Error("caller stopped extracting");
      const extractor = createExtractor({
        loaders: [fakeLoader()],
        strategies: [{ ...fakeStrategy(), async extract() {
          controller.abort(reason);
          if (reaction === "reject") throw reason;
          return { data: { value: "cancelled" } };
        } }],
      });
      const outcome = await extractor.extract(PDF_BYTES, z.object({ value: z.string() }), { signal: controller.signal })
        .catch((error: unknown) => error);
      expect(outcome).toBe(reason);
    });

    it(`preserves the caller reason when a layout analyzer ${reaction}s after cancellation`, async () => {
      const controller = new AbortController();
      const reason = new Error("caller stopped converting");
      const converter = new DocumentConverter({
        loaders: [fakeLoader()],
        layoutAnalyzer: { name: "cancelled", async analyze() {
          controller.abort(reason);
          if (reaction === "reject") throw reason;
          return { annotations: [] };
        } },
      });
      const outcome = await converter.convert(PDF_BYTES, { signal: controller.signal }).catch((error: unknown) => error);
      expect(outcome).toBe(reason);
    });
  }

  it("rejects an already-cancelled preloaded conversion with the caller reason", async () => {
    const reason = new Error("caller already stopped");
    const outcome = await new DocumentConverter().convert({ loaded: doc("Invoice") }, {
      signal: AbortSignal.abort(reason),
    }).catch((error: unknown) => error);
    expect(outcome).toBe(reason);
  });
});
