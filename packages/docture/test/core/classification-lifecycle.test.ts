import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createExtractor, type Classifier, type ClassificationSignal } from "../../src/core/index.js";
import { PDF_BYTES, fakeClassifier, fakeLoader } from "./fakes.js";

const candidates = [{ name: "invoice", description: "Invoice", schema: z.object({}) }];
const vote = (classifier: string): ClassificationSignal => ({ classifier, name: "invoice", confidence: 1 });

describe("classification loading", () => {
  it("falls back to the next loader after a load failure", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader({ name: "broken", fail: "engine crashed" }), fakeLoader({ name: "working" })],
      classifiers: [fakeClassifier("keyword", vote("keyword"))],
    });
    const result = await extractor.classify(PDF_BYTES, candidates).catch(() => null);
    expect(result?.name).toBe("invoice");
  });

  it("falls back when the first loader reaches its stage deadline", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const extractor = createExtractor({
      loaders: [fakeLoader({ name: "hanging", hang: true }), fakeLoader({ name: "working" })],
      classifiers: [fakeClassifier("keyword", vote("keyword"))],
    });
    let name: string | undefined;
    const task = extractor.classify(PDF_BYTES, candidates, { signal: caller.signal, stageTimeoutMs: 10 })
      .then((result) => { name = result.name; }, () => undefined);
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(name).toBe("invoice");
    } finally {
      caller.abort();
      await task;
      vi.useRealTimers();
    }
  });
});

describe("classification scheduling", () => {
  it("starts classifiers together and keeps registration order", async () => {
    const started: string[] = [];
    const firstStarted = Promise.withResolvers<void>();
    const first = Promise.withResolvers<ClassificationSignal>();
    const second = Promise.withResolvers<ClassificationSignal>();
    const classifier = (name: string, pending: Promise<ClassificationSignal>): Classifier => ({
      name,
      classify() { started.push(name); if (name === "first") firstStarted.resolve(); return pending; },
    });
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      classifiers: [classifier("first", first.promise), classifier("second", second.promise)],
    });
    const task = extractor.classify(PDF_BYTES, candidates);
    try {
      await firstStarted.promise;
      expect(started).toEqual(["first", "second"]);
    } finally {
      second.resolve(vote("second"));
      first.resolve(vote("first"));
      const result = await task;
      expect(result.signals.map((signal) => signal.classifier)).toEqual(["first", "second"]);
      expect(result.name).toBe("invoice");
    }
  });

  it("records thrown classifiers as abstentions and propagates caller abort", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      classifiers: [fakeClassifier("broken", "throw"), fakeClassifier("working", vote("working"))],
    });
    const result = await extractor.classify(PDF_BYTES, candidates);
    expect(result.signals).toEqual([
      { classifier: "broken", name: null, confidence: 0, note: "threw: classifier exploded" },
      vote("working"),
    ]);
    const aborted = createExtractor({
      loaders: [fakeLoader()],
      classifiers: [{ name: "cancelled", async classify() { throw new DOMException("stopped", "AbortError"); } }],
    });
    await expect(aborted.classify(PDF_BYTES, candidates)).rejects.toMatchObject({ name: "AbortError", message: "stopped" });
  });
});
