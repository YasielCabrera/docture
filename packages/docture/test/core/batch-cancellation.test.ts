import { expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, DocumentConverter } from "docture";
import { doc, fakeLoader, PDF_BYTES } from "./fakes.js";

function controlledWork() {
  const counters = { started: 0, aborted: 0, settled: 0 };
  const releases: (() => void)[] = [];
  const run = async (signal: AbortSignal) => {
    counters.started += 1;
    if (counters.started === 1) {
      await Promise.resolve();
    } else {
      await new Promise<void>((resolve) => {
        const abort = () => { counters.aborted += 1; resolve(); };
        signal.addEventListener("abort", abort, { once: true });
        releases.push(() => { signal.removeEventListener("abort", abort); resolve(); });
        if (signal.aborted) abort();
      });
    }
    counters.settled += 1;
  };
  return { counters, run, release: () => releases.forEach((release) => release()) };
}

for (const operation of ["extract", "convert"]) {
  for (const exit of ["break", "return", "throw"]) {
    it(`${operation} batch aborts and settles in-flight jobs on consumer ${exit}`, async () => {
      const work = controlledWork();
      const sources = Array.from({ length: 10 }, () => PDF_BYTES);
      const batch = operation === "extract"
        ? createExtractor({
          loaders: [fakeLoader()],
          strategies: [{ name: "controlled", async extract(ctx) { await work.run(ctx.signal); return { data: { total: 10 } }; } }],
        }).extractBatch(sources, z.object({ total: z.number() }), { concurrency: 4 })
        : new DocumentConverter({ loaders: [{
          ...fakeLoader(), async load(_raw, ctx) { await work.run(ctx.signal); return doc("Invoice text"); },
        }] }).convertBatch(sources, { concurrency: 4 });
      const failure = new Error("Consumer failed");
      try {
        if (exit === "return") {
          expect((await batch.next()).value?.outcome.ok).toBe(true);
          await batch.return();
        } else {
          try {
            for await (const item of batch) {
              expect(item.outcome.ok).toBe(true);
              if (exit === "throw") throw failure;
              break;
            }
          } catch (error) {
            expect(error).toBe(failure);
          }
        }
        expect(work.counters).toEqual({ started: 4, aborted: 3, settled: 4 });
      } finally {
        work.release();
      }
    });
  }

  it(`${operation} batch keeps the caller signal connected to every in-flight job`, async () => {
    const work = controlledWork();
    const controller = new AbortController();
    const sources = Array.from({ length: 4 }, () => PDF_BYTES);
    const options = { concurrency: 4, signal: controller.signal };
    const batch = operation === "extract"
      ? createExtractor({ loaders: [fakeLoader()], strategies: [{
        name: "controlled", async extract(ctx) { await work.run(ctx.signal); return { data: { total: 10 } }; },
      }] }).extractBatch(sources, z.object({ total: z.number() }), options)
      : new DocumentConverter({ loaders: [{ ...fakeLoader(), async load(_raw, ctx) { await work.run(ctx.signal); return doc("Invoice text"); } }] }).convertBatch(sources, options);
    try {
      const first = await batch.next();
      expect(first.value?.outcome.ok).toBe(true);
      controller.abort(new Error("Caller stopped"));
      let consumed = 1;
      for await (const _item of batch) consumed += 1;
      expect(consumed).toBe(4);
      expect(work.counters).toEqual({ started: 4, aborted: 3, settled: 4 });
    } finally {
      work.release();
    }
  });
}
