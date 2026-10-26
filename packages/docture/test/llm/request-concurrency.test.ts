import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, defineStrategy, withRasterizer, type Rasterizer } from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import type { CachedResponse, LlmCache } from "docture/llm/cache";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const schema = z.object({ items: z.array(z.number()) });
const bytes = new Uint8Array([1]);

function controlled(kind: "text" | "vision", pageCount = 6) {
  const gates = Array.from({ length: pageCount }, () => Promise.withResolvers<void>());
  const starts = Array.from({ length: pageCount }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  const aborted: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const model = new MockLanguageModelV4({
    async doGenerate(options) {
      const index = started.length;
      started.push(index);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      starts[index]?.resolve();
      const gate = gates[index];
      if (gate === undefined) throw new Error("Unexpected model request");
      const onAbort = () => { aborted.push(index); gate.reject(options.abortSignal?.reason); };
      options.abortSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        await gate.promise;
        return await mockModel([{ items: [index + 1] }]).model.doGenerate(options);
      } finally {
        options.abortSignal?.removeEventListener("abort", onAbort);
        inFlight -= 1;
      }
    },
  });
  const rasterizer: Rasterizer = {
    name: "pages", formats: ["png"],
    async rasterize(_raw, options) {
      return (options.pages ?? [1]).map((pageNumber) => ({
        pageNumber, bytes: new Uint8Array([137,80,78,71,13,10,26,10,pageNumber]),
        widthPx: 1, heightPx: 1, scale: 1, format: "png" as const,
      }));
    },
  };
  const base = inMemoryLoader(loadedDocument(Array.from({ length: pageCount }, (_, i) => `Source page ${i + 1}. Invoice INV-42 with a complete text layer and a total of 12.00 EUR.`)));
  const loader = kind === "text" ? base : withRasterizer(base, rasterizer);
  const make = (concurrency?: number) => createExtractor({
    loaders: [loader],
    strategies: [kind === "text"
      ? llm({ model, completion: "paginate", maxRetries: 0, ...(concurrency === undefined ? {} : { concurrency }) })
      : vision({ model, pageMode: "perPage", maxRetries: 0, ...(concurrency === undefined ? {} : { concurrency }) })],
  });
  return { gates, starts, started, aborted, make, get maxInFlight() { return maxInFlight; } };
}

describe.each(["text", "vision"] as const)("%s request concurrency", (kind) => {
  it("retains completed request usage when a sibling transport request fails", async () => {
    const completed = Promise.withResolvers<void>();
    const successful = mockModel([{ items: [1] }]);
    let calls = 0;
    const model = new MockLanguageModelV4({
      modelId: "paid-model",
      async doGenerate(options) {
        if (calls++ === 0) return successful.model.doGenerate(options);
        await completed.promise;
        throw new Error("transport failed");
      },
    });
    const cache: LlmCache = {
      async get() { return undefined; },
      async set() { completed.resolve(); },
    };
    const base = inMemoryLoader(loadedDocument([
      "Invoice first page with more than fifty characters of readable source text.",
      "Invoice second page with more than fifty characters of readable source text.",
    ]));
    const rasterizer: Rasterizer = {
      name: "images", formats: ["png"],
      async rasterize(_raw, options) {
        return (options.pages ?? [1]).map((pageNumber) => ({
          pageNumber, bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, pageNumber]),
          widthPx: 1, heightPx: 1, scale: 1, format: "png" as const,
        }));
      },
    };
    const pricing = { "paid-model": { inputPerMillion: 1, outputPerMillion: 2 } };
    const extractor = createExtractor({
      loaders: [kind === "text" ? base : withRasterizer(base, rasterizer)],
      strategies: [
        kind === "text"
          ? llm({ model, completion: "paginate", concurrency: 2, maxRetries: 0, cache, pricing })
          : vision({ model, pageMode: "perPage", concurrency: 2, maxRetries: 0, cache, pricing }),
        defineStrategy({ name: "fallback", async extract() { return { data: { items: [7] } }; } }),
      ],
    });
    const result = await extractor.extract(bytes, schema);
    expect(result.data).toEqual({ items: [7] });
    expect(calls).toBe(2);
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 25, totalTokens: 125 });
    expect(result.usage.costUsd).toBeCloseTo(0.00015, 12);
    expect(result.attempts[0]).toMatchObject({
      status: "failed", error: "transport failed",
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
    expect(result.attempts[0]?.usage?.costUsd).toBeCloseTo(0.00015, 12);
    expect(result.attempts[0]?.errorCode).toBeUndefined();
  });

  it("bounds in-flight requests and merges reverse completions in page order", async () => {
    const run = controlled(kind);
    const task = run.make(2).extract(bytes, schema);
    try {
      await run.starts[0]?.promise;
      await setImmediate();
      expect(run.started).toEqual([0, 1]);
      for (let index = 1; index < 6; index += 1) {
        run.gates[index]?.resolve();
        if (index < 5) await run.starts[index + 1]?.promise;
      }
      run.gates[0]?.resolve();
      const result = await task;
      expect(run.maxInFlight).toBe(2);
      expect(result.data).toEqual({ items: [1, 2, 3, 4, 5, 6] });
      expect(result.usage).toMatchObject({ inputTokens: 600, outputTokens: 150, totalTokens: 750 });
    } finally {
      run.gates.forEach((gate) => gate.resolve());
      await task.catch(() => undefined);
    }
  });

  it("uses four workers by default", async () => {
    const run = controlled(kind);
    const task = run.make().extract(bytes, schema);
    try {
      await run.starts[0]?.promise;
      await setImmediate();
      expect(run.started).toEqual([0, 1, 2, 3]);
    } finally {
      run.gates.forEach((gate) => gate.resolve());
      expect((await task).data).toEqual({ items: [1, 2, 3, 4, 5, 6] });
    }
  });

  it("keeps concurrency one sequential", async () => {
    const run = controlled(kind, 2);
    const task = run.make(1).extract(bytes, schema);
    await run.starts[0]?.promise;
    await setImmediate();
    expect(run.started).toEqual([0]);
    run.gates[0]?.resolve();
    await run.starts[1]?.promise;
    run.gates[1]?.resolve();
    expect((await task).data).toEqual({ items: [1, 2] });
    expect(run.maxInFlight).toBe(1);
  });

  it("aborts the remaining request and starts no new paid work after failure", async () => {
    const run = controlled(kind);
    const task = run.make(2).safeExtract(bytes, schema);
    try {
      await run.starts[0]?.promise;
      await setImmediate();
      expect(run.started).toEqual([0, 1]);
      run.gates[0]?.reject(new Error("provider failed"));
      const result = await task;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected provider failure");
      expect(result.error.message).toContain("provider failed");
      expect(run.started).toEqual([0, 1]);
      expect(run.aborted).toEqual([1]);
    } finally {
      run.gates.forEach((gate) => gate.resolve());
      await task;
    }
  });

  it("propagates caller abort without starting more requests", async () => {
    const run = controlled(kind);
    const caller = new AbortController();
    const task = run.make(2).safeExtract(bytes, schema, { signal: caller.signal });
    try {
      await run.starts[0]?.promise;
      await setImmediate();
      expect(run.started).toEqual([0, 1]);
      caller.abort(new DOMException("caller stopped", "AbortError"));
      const result = await task;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected caller abort");
      expect(result.error).toMatchObject({ name: "AbortError", message: "caller stopped" });
      expect(run.started).toEqual([0, 1]);
      expect(run.aborted).toEqual([0, 1]);
    } finally {
      caller.abort();
      run.gates.forEach((gate) => gate.resolve());
      await task;
    }
  });

  it("propagates a caller's custom abort reason after completed work", async () => {
    const run = controlled(kind, 2);
    const caller = new AbortController();
    const task = run.make(2).safeExtract(bytes, schema, { signal: caller.signal });
    const reason = new Error("caller stopped");
    try {
      await run.starts[0]?.promise;
      run.gates[0]?.resolve();
      await run.starts[1]?.promise;
      await setImmediate();
      caller.abort(reason);
      const result = await task;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(reason);
    } finally {
      caller.abort();
      run.gates.forEach((gate) => gate.resolve());
      await task;
    }
  });
});

it("preserves cached chunk order and token totals when hits mix with fresh requests", async () => {
  const entries = new Map<string, CachedResponse>();
  const cache: LlmCache = {
    async get(key) { return entries.get(key); },
    async set(key, value) { entries.set(key, value); },
  };
  const { model, calls } = mockModel([1,2,3,4,5,6,2,4,6].map((value) => ({ items: [value] })));
  const extractor = createExtractor({
    loaders: [inMemoryLoader(loadedDocument(["one","two","three","four","five","six"].map((page) => `Invoice page ${page} with enough text to qualify as a complete text layer.`)))],
    strategies: [llm({ model, completion: "paginate", concurrency: 2, cache })],
  });
  const first = await extractor.extract(bytes, schema);
  Array.from(entries.keys()).forEach((key, index) => { if (index % 2 === 1) entries.delete(key); });
  const second = await extractor.extract(bytes, schema);
  expect(first.data).toEqual({ items: [1,2,3,4,5,6] });
  expect(second.data).toEqual({ items: [1,2,3,4,5,6] });
  expect(second.usage).toMatchObject({ inputTokens: 600, outputTokens: 150, totalTokens: 750 });
  expect(calls).toHaveLength(9);
});
