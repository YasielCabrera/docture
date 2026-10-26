import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Extractor, DocumentConverter, type ClassificationSignal } from "../../src/core/index.js";
import { doc, fakeLoader } from "./fakes.js";

const source = { loaded: doc("Invoice") };
const usage = { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 2 };
afterEach(() => vi.useRealTimers());

describe("late stage results", () => {
  it("records a classifier's standard abort rejection as an owned deadline abstention", async () => {
    vi.useFakeTimers();
    const extractor = new Extractor({ loaders: [fakeLoader()], classifiers: [{ name: "timed", classify(ctx) {
      return new Promise<never>((_resolve, reject) => ctx.signal.addEventListener("abort", () => {
        reject(new DOMException("operation stopped", "AbortError"));
      }, { once: true }));
    } }] });
    const task = extractor.classify(source, [], { stageTimeoutMs: 10 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await task).toMatchObject({ name: "UNKNOWN", signals: [{
      classifier: "timed", name: null, confidence: 0,
      note: 'threw: "classify:timed" exceeded its 10ms deadline.',
    }] });
  });

  it.each([false, true])("attributes a returned strategy's usage once after timeout with callback %s", async (report) => {
    vi.useFakeTimers();
    const extractor = new Extractor({ loaders: [fakeLoader()], strategies: [{ name: "paid", extract(ctx) {
      if (report) ctx.reportFailureUsage?.(usage);
      return new Promise((resolve) => ctx.signal.addEventListener("abort", () => {
        resolve({ data: { value: "late" }, usage });
      }, { once: true }));
    } }, { name: "fallback", async extract() { return { data: { value: "fallback" } }; } }] });
    const task = extractor.extract(source, z.object({ value: z.string() }), { stageTimeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await task;
    expect(result.data).toEqual({ value: "fallback" });
    expect(result.usage).toMatchObject(usage);
    expect(result.attempts[0]).toMatchObject({
      strategy: "paid", status: "failed", errorCode: "TIMEOUT", usage,
    });
  });

  it("keeps billed usage when a classifier returns after its deadline", async () => {
    vi.useFakeTimers();
    const extractor = new Extractor({ loaders: [fakeLoader()], classifiers: [{ name: "paid", classify(ctx) {
      return new Promise<ClassificationSignal>((resolve) => ctx.signal.addEventListener("abort", () => {
        resolve({ classifier: "paid", name: "invoice", confidence: 1, usage });
      }, { once: true }));
    } }] });
    const task = extractor.classify(source, [], { stageTimeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await task;
    expect(result.name).toBe("UNKNOWN");
    expect(result.signals).toEqual([{
      classifier: "paid", name: null, confidence: 0,
      note: 'threw: "classify:paid" exceeded its 10ms deadline.', usage,
    }]);
  });

  it("keeps billed usage when a layout analyzer returns after its deadline", async () => {
    vi.useFakeTimers();
    const converter = new DocumentConverter({ layoutAnalyzer: { name: "paid", analyze(ctx) {
      return new Promise((resolve) => ctx.signal.addEventListener("abort", () => {
        resolve({ annotations: [], usage });
      }, { once: true }));
    } } });
    const task = converter.convert(source, { stageTimeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await task;
    expect(result.method).toBe("deterministic");
    expect(result.usage).toMatchObject(usage);
    expect(result.attempts.at(-1)).toMatchObject({
      stage: "layout", strategy: "paid", status: "failed", errorCode: "TIMEOUT", usage,
    });
  });
});
