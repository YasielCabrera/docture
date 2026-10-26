import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { createExtractor, withRasterizer, type RasterOptions, type Rasterizer } from "docture";
import { vision } from "docture/llm/vision";
import { memoryCache } from "docture/llm/cache";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

function setup(pageCount: number, answers: readonly unknown[], constantBytes = false, answerByPage?: Readonly<Record<number, unknown>>) {
  const renders: RasterOptions[] = [];
  const groups: number[][] = [];
  const schemas: unknown[] = [];
  const handle = mockModel(answers);
  const model = new MockLanguageModelV4({
    async doGenerate(options) {
      const group = options.prompt.flatMap((message) => message.role !== "user" ? [] :
        message.content.flatMap((part) => part.type === "file" && part.data.type === "data" && part.data.data instanceof Uint8Array
          ? [part.data.data.at(-1) ?? 0] : []));
      groups.push(group);
      schemas.push(options.responseFormat);
      if (answerByPage !== undefined) return mockModel([answerByPage[group[0] ?? 0]]).model.doGenerate(options);
      return handle.model.doGenerate(options);
    },
  });
  const rasterizer: Rasterizer = {
    name: "pages", formats: ["png"],
    async rasterize(_raw, options) {
      renders.push(options);
      return (options.pages ?? [1]).map((pageNumber) => ({
        pageNumber, bytes: new Uint8Array([137,80,78,71,13,10,26,10,constantBytes ? 1 : pageNumber]),
        widthPx: 1, heightPx: 1, scale: 1, format: "png" as const,
      }));
    },
  };
  const loader = withRasterizer(inMemoryLoader(loadedDocument(Array.from({ length: pageCount }, (_, i) => `Page ${i + 1}`))), rasterizer);
  return { model, loader, renders, groups, schemas, calls: handle.calls };
}

describe("vision request limits", () => {
  it("caps the default long edge and honors an explicit override", async () => {
    const setupRun = setup(1, [{ value: "ok" }]);
    for (const options of [{}, { maxEdge: 900 }]) {
      await createExtractor({ loaders: [setupRun.loader], strategies: [vision({ model: setupRun.model, ...options })] })
        .extract(new Uint8Array([1]), z.object({ value: z.string() }));
    }
    expect(setupRun.renders.map((options) => options.maxEdge)).toEqual([1568, 900]);
  });

  it("splits together requests into ordered groups and validates the merged document", async () => {
    const run = setup(5, [], false, { 1: { invoice: "INV-42", items: [1, 2] }, 3: { items: [3, 4] }, 5: { items: [5] } });
    const result = await createExtractor({
      loaders: [run.loader], strategies: [vision({ model: run.model, pagesPerRequest: 2 })],
    }).extract(new Uint8Array([1]), z.object({ invoice: z.string(), items: z.array(z.number()) }));
    expect(run.groups.toSorted((a, b) => (a[0] ?? 0) - (b[0] ?? 0))).toEqual([[1, 2], [3, 4], [5]]);
    expect(result.data).toEqual({ invoice: "INV-42", items: [1, 2, 3, 4, 5] });
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 75, totalTokens: 375 });
  });

  it("keeps one request at the cap on the original strict schema", async () => {
    const run = setup(2, [{ items: [1, 2] }]);
    const result = await createExtractor({
      loaders: [run.loader], strategies: [vision({ model: run.model, pagesPerRequest: 2 })],
    }).safeExtract(new Uint8Array([1]), z.object({ invoice: z.string(), items: z.array(z.number()) }));
    expect(run.groups).toEqual([[1, 2]]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(run.schemas)).toContain('"required":["invoice","items"]');
  });

  it("separates render and group variants even when rendered bytes are identical", async () => {
    const run = setup(1, [{ value: "first" }, { value: "second" }, { value: "third" }], true);
    const cache = memoryCache();
    const values: string[] = [];
    for (const options of [
      { maxEdge: 900, pagesPerRequest: 2 },
      { maxEdge: 1200, pagesPerRequest: 2 },
      { maxEdge: 1200, pagesPerRequest: 3 },
    ]) {
      const result = await createExtractor({
        loaders: [run.loader], strategies: [vision({ model: run.model, cache, ...options })],
      }).extract(new Uint8Array([1]), z.object({ value: z.string() }));
      values.push(result.data.value);
    }
    expect(values).toEqual(["first", "second", "third"]);
    expect(run.calls).toHaveLength(3);
  });

  it("rejects a nonpositive or fractional page-group limit", () => {
    const { model } = mockModel([{}]);
    for (const pagesPerRequest of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => vision({ model, pagesPerRequest })).toThrowError("pagesPerRequest must be a positive integer");
    }
  });
});
