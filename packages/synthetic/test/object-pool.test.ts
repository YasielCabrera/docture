import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { llmObjectPool, type ObjectPoolOptions } from "../src/llm/index.js";

const replying = (values: unknown[], modelId = "profile-writer"): MockLanguageModelV4 => new MockLanguageModelV4({
  modelId,
  doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify({ values }) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
    warnings: [],
  }),
});

const Route = z.object({ entry: z.string().trim().min(1), via: z.array(z.string()), exit: z.string().min(1), kilometres: z.string().transform(Number) });
const routes = [
  { entry: " Bremen ", via: ["A1"], exit: "Hamburg", kilometres: "110" },
  { entry: "Hannover", via: ["A2", "A7"], exit: "Kassel", kilometres: "170" },
];

describe("llmObjectPool", () => {
  it("rebases references inside schemas for JSON-encoded strings", async () => {
    const Text = z.string();
    const schema = {
      "~standard": {
        ...Text["~standard"],
        jsonSchema: { input: () => ({
          type: "string",
          $defs: { label: { type: "string" } },
          contentMediaType: "application/json",
          contentSchema: { type: "object", properties: { name: { $ref: "#/$defs/label" } } },
        }) },
      },
    };
    const model = replying(['{"name":"Fleet"}']);
    expect(await llmObjectPool({ schema, revision: "encoded-1", prompt: "Encoded names", count: 1, source: { kind: "model", model } })).toEqual(['{"name":"Fleet"}']);
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ schema: { properties: { values: { items: {
      contentSchema: { properties: { name: { $ref: "#/properties/values/items/$defs/label" } } },
    } } } } });
  });

  it("keeps recursive record references scoped to each pool item", async () => {
    const Tree = z.object({ name: z.string(), get children(): z.ZodArray<typeof Tree> { return z.array(Tree); } }).meta({ examples: [{ $ref: "#" }] });
    const record = { name: "Fleet", children: [{ name: "Truck", children: [] }] };
    const model = replying([record]);
    expect(await llmObjectPool({ schema: Tree, revision: "tree-1", prompt: "Fleet tree", count: 1, source: { kind: "model", model } })).toEqual([record]);
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ schema: { properties: { values: { items: { examples: [{ $ref: "#" }], properties: { children: { items: { $ref: "#/properties/values/items" } } } } } } } });
  });

  it("rebases local definition pointers while preserving identified schema resources", async () => {
    const Record = z.object({ name: z.string() });
    const generated = [{ name: "Product" }];
    const schema = {
      "~standard": {
        ...Record["~standard"],
        jsonSchema: { input: () => ({
          type: "object",
          $defs: { label: { type: "string" } },
          properties: {
            name: { $ref: "#/$defs/label" },
            resource: { $id: "https://example.invalid/resource", type: "object", properties: { child: { $ref: "#" } } },
          },
        }) },
      },
    };
    const model = replying(generated);
    expect(await llmObjectPool({ schema, revision: "definitions-1", prompt: "Product names", count: 1, source: { kind: "model", model } })).toEqual(generated);
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ schema: { properties: { values: { items: { properties: {
      name: { $ref: "#/properties/values/items/$defs/label" },
      resource: { properties: { child: { $ref: "#" } } },
    } } } } } });
  });

  it.each(["", "#"])("rebases local references when schema ID %j retains the enclosing resource", async ($id) => {
    const Record = z.object({ name: z.string() });
    const schema = {
      "~standard": {
        ...Record["~standard"],
        jsonSchema: { input: () => ({
          $id, type: "object",
          $defs: { label: { type: "string" } },
          properties: { name: { $ref: "#/$defs/label" } },
          required: ["name"],
        }) },
      },
    };
    const model = replying([{ name: "Ada" }]);
    expect(await llmObjectPool({ schema, revision: "names-1", prompt: "Names", count: 1, source: { kind: "model", model } })).toEqual([{ name: "Ada" }]);
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ schema: { properties: { values: { items: {
      $id, properties: { name: { $ref: "#/properties/values/items/$defs/label" } },
    } } } } });
  });

  it("requests nested structured records and returns schema outputs", async () => {
    const model = replying(routes);
    const values = await llmObjectPool({ schema: Route, revision: "routes-1", prompt: "Fictional German toll journeys", count: 2, source: { kind: "model", model } });
    expectTypeOf(values).toEqualTypeOf<readonly z.output<typeof Route>[]>();
    expect(values).toEqual([
      { entry: "Bremen", via: ["A1"], exit: "Hamburg", kilometres: 110 },
      { entry: "Hannover", via: ["A2", "A7"], exit: "Kassel", kilometres: 170 },
    ]);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.temperature).toBe(0);
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ type: "json", schema: { properties: { values: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", properties: { kilometres: { type: "string" }, via: { type: "array", items: { type: "string" } } } } } } } });
  });

  it("serves raw cached records offline and applies each transform once", async () => {
    const cache = new Map<string, readonly unknown[]>();
    const model = replying(routes);
    const common = { schema: Route, revision: "routes-1", prompt: "Journeys", count: 2, cache };
    const generated = await llmObjectPool({ ...common, source: { kind: "model", model } });
    const offline = await llmObjectPool({ ...common, source: { kind: "cache-only", model: "mock-provider/profile-writer" } });
    expect(offline).toEqual(generated);
    expect([...cache.values()]).toEqual([routes]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("rejects invalid cached values without another model call", async () => {
    const cache = new Map<string, readonly unknown[]>();
    const model = replying(routes);
    const options = { schema: Route, revision: "routes-1", prompt: "Journeys", count: 2, source: { kind: "model", model }, cache } satisfies ObjectPoolOptions<z.output<typeof Route>>;
    await llmObjectPool(options);
    const key = [...cache.keys()][0];
    if (key === undefined) throw new Error("No cache entry was written");
    cache.set(key, [{ ...routes[0], entry: "" }, routes[1]]);
    await expect(llmObjectPool(options)).rejects.toThrow("valuePool.cache[0].entry");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("separates model, prompt, temperature, schema and validation-policy identities", async () => {
    const cache = new Map<string, readonly unknown[]>();
    const model = replying(routes);
    const common = { schema: Route, revision: "routes-1", prompt: "Journeys", count: 2, source: { kind: "model", model }, cache } satisfies ObjectPoolOptions<z.output<typeof Route>>;
    await llmObjectPool(common);
    await llmObjectPool(common);
    await llmObjectPool({ ...common, prompt: "Other journeys" });
    await llmObjectPool({ ...common, temperature: 0.4 });
    await llmObjectPool({ ...common, revision: "routes-2" });
    await llmObjectPool({ ...common, schema: Route.extend({ country: z.string().default("DE") }) });
    const other = replying(routes, "another-writer");
    await llmObjectPool({ ...common, source: { kind: "model", model: other } });
    expect(model.doGenerateCalls).toHaveLength(5);
    expect(other.doGenerateCalls).toHaveLength(1);
    expect(cache.size).toBe(6);
  });

  it("rejects provider records that violate refinements, repeat or have the wrong count", async () => {
    const cache = new Map<string, readonly unknown[]>();
    const common = { schema: Route.refine(route => route.kilometres > 0, "distance must be positive"), revision: "routes-1", prompt: "Journeys", count: 2, cache };
    await expect(llmObjectPool({ ...common, source: { kind: "model", model: replying([{ ...routes[0], kilometres: "-1" }, routes[1]]) } })).rejects.toThrow("distance must be positive");
    await expect(llmObjectPool({ ...common, source: { kind: "model", model: replying([routes[0], routes[0]]) } })).rejects.toThrow("duplicates validated output");
    await expect(llmObjectPool({ ...common, source: { kind: "model", model: replying([routes[0]]) } })).rejects.toThrow("expected exactly 2 raw values");
    expect(cache.size).toBe(0);
  });

  it("fails explicit offline misses and invalid configuration", async () => {
    const common = { schema: Route, revision: "routes-1", prompt: "Journeys", count: 2, cache: new Map<string, readonly unknown[]>() };
    await expect(llmObjectPool({ ...common, source: { kind: "cache-only", model: "provider/missing" } })).rejects.toThrow("no cached pool");
    await expect(llmObjectPool({ ...common, prompt: " ", source: { kind: "cache-only", model: "provider/missing" } })).rejects.toThrow("nonempty prompt");
    await expect(llmObjectPool({ ...common, temperature: Number.NaN, source: { kind: "cache-only", model: "provider/missing" } })).rejects.toThrow("temperature must be finite");
  });
});
