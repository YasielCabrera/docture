import { describe, expect, it } from "vitest";
import { jsonSchema } from "ai";
import { ContractViolationError, createExtractor, withRasterizer, type Rasterizer } from "docture";
import { cacheKey, memoryCache } from "docture/llm/cache";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { positionedDocument, replyModel } from "./citation-fixtures.js";

function incrementingTotal() {
  return jsonSchema<{ total: number }>(
    { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
    {
      validate: (value) => {
        const total = (value as { total?: unknown } | null)?.total;
        return typeof total === "number" && total >= 0
          ? { success: true, value: { total: total + 1 } }
          : { success: false, error: new TypeError("total must be a non-negative number") };
      },
    },
  );
}

function mutatingTotal() {
  return jsonSchema<{ total: number }>(
    { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
    {
      validate: (value) => {
        const answer = value as { total: number };
        answer.total += 1;
        return { success: true, value: answer };
      },
    },
  );
}

function sentPrompt(prompt: unknown): { system: string; prompt: string } {
  const [system, user] = prompt as [{ content: string }, { content: { text: string }[] }];
  return { system: system.content, prompt: user.content.map((part) => part.text).join("") };
}

const text = () => [inMemoryLoader(loadedDocument(["Invoice total 1 with enough text to be a readable document."]))];
const lines = positionedDocument([["Total 1 due on receipt", "Invoice INV-0042 issued by ACME Corp"]]);

const raster: Rasterizer = {
  name: "fixture-raster",
  formats: ["png"],
  async rasterize(doc, options) {
    return (options.pages ?? [1]).map((pageNumber) => ({
      pageNumber, bytes: new Uint8Array([doc.bytes[0] ?? 0, pageNumber]), widthPx: 1, heightPx: 1, format: "png" as const, scale: 1,
    }));
  },
};

describe("caller schema transforms", () => {
  it("apply once to a single text request", async () => {
    const { model, calls } = replyModel([{ total: 1 }]);
    const result = await createExtractor({ loaders: text(), strategies: [llm({ model })] })
      .extract(new Uint8Array([1]), incrementingTotal());
    expect(calls).toHaveLength(1);
    expect(result.data).toEqual({ total: 2 });
  });

  it("apply once when the validator changes the answer in place", async () => {
    const { model, calls } = replyModel([{ total: 1 }]);
    const result = await createExtractor({ loaders: text(), strategies: [llm({ model })] })
      .extract(new Uint8Array([1]), mutatingTotal());
    expect(calls).toHaveLength(1);
    expect(result.data).toEqual({ total: 2 });
  });

  it("do not reuse a cached answer stored already transformed by an older version", async () => {
    const { model, calls } = replyModel([{ total: 1 }]);
    const extractor = (cache = memoryCache()) => createExtractor({ loaders: text(), strategies: [llm({ model, cache })] });
    await extractor().extract(new Uint8Array([1]), incrementingTotal());
    const cache = memoryCache();
    await cache.set(cacheKey({
      provider: "mock",
      modelId: "mock-model",
      temperature: undefined,
      ...sentPrompt(calls[0]?.prompt),
      jsonSchema: { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
      variant: "strict",
    }), { data: { total: 2 }, usage: {} });
    const result = await extractor(cache).extract(new Uint8Array([1]), incrementingTotal());
    expect(calls).toHaveLength(2);
    expect(result.data).toEqual({ total: 2 });
  });

  it("apply once to a cached text answer", async () => {
    const { model, calls } = replyModel([{ total: 1 }]);
    const cache = memoryCache();
    const extractor = createExtractor({ loaders: text(), strategies: [llm({ model, cache })] });
    const fresh = await extractor.extract(new Uint8Array([1]), incrementingTotal());
    const hit = await extractor.extract(new Uint8Array([1]), incrementingTotal());
    expect(calls).toHaveLength(1);
    expect([fresh.data, hit.data]).toEqual([{ total: 2 }, { total: 2 }]);
  });

  it("apply once to a cited answer, fresh and cached", async () => {
    const { model, calls } = replyModel([{ data: { total: 1 }, citations: [{ path: "total", ids: ["p1-line-1"] }] }]);
    const cache = memoryCache();
    const run = () => createExtractor({
      loaders: [inMemoryLoader(lines)],
      strategies: [llm({ model, cache, citations: true })],
    }).extract({ loaded: lines }, incrementingTotal());
    const fresh = await run();
    const hit = await run();
    expect(calls).toHaveLength(1);
    expect([fresh.data, hit.data]).toEqual([{ total: 2 }, { total: 2 }]);
    expect(fresh.citations).toEqual([{ path: "total", ids: ["p1-line-1"], status: "cited-unverified" }]);
  });

  it("apply once to a repaired text answer", async () => {
    const { model, calls } = replyModel([{ total: -1 }, { total: 1 }]);
    const result = await createExtractor({ loaders: text(), strategies: [llm({ model })] })
      .extract(new Uint8Array([1]), incrementingTotal());
    expect(calls).toHaveLength(2);
    expect(result.attempts.map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(result.data).toEqual({ total: 2 });
  });

  it("apply once to a vision answer, fresh, cached and repaired", async () => {
    const { model, calls } = replyModel([{ total: 1 }, { total: -1 }, { total: 1 }]);
    const cache = memoryCache();
    const run = (bytes: number) => createExtractor({
      loaders: [withRasterizer(inMemoryLoader(loadedDocument(["x"])), raster)],
      strategies: [vision({ model, cache })],
    }).extract(new Uint8Array([bytes]), incrementingTotal());
    const fresh = await run(1);
    const hit = await run(1);
    expect(calls).toHaveLength(1);
    const repaired = await run(2);
    expect(calls).toHaveLength(3);
    expect([fresh.data, hit.data, repaired.data]).toEqual([{ total: 2 }, { total: 2 }, { total: 2 }]);
  });

  it("apply once to a merged multi-page answer after full-schema validation", async () => {
    const { model, calls } = replyModel((prompt) => prompt.includes("Total 1") ? { total: 1 } : {});
    const pages = positionedDocument([["Total 1 due on receipt"], ["Please pay within thirty days."]]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(pages)],
      strategies: [llm({ model, completion: "paginate" })],
    }).extract({ loaded: pages }, incrementingTotal());
    expect(calls).toHaveLength(2);
    expect(result.data).toEqual({ total: 2 });
  });

  it("reject a merged multi-page answer that misses a required field", async () => {
    const { model } = replyModel([{}]);
    const pages = positionedDocument([["Total due on receipt"], ["Please pay within thirty days."]]);
    const failure = await createExtractor({
      loaders: [inMemoryLoader(pages)],
      strategies: [llm({ model, completion: "paginate" })],
      maxRepairs: 0,
    }).extract({ loaded: pages }, incrementingTotal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContractViolationError);
    expect((failure as ContractViolationError).issues).toEqual([{ path: "", message: "Type validation failed: Value: {}.\nError message: TypeError: total must be a non-negative number" }]);
  });
});
