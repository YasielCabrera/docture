import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createExtractor, silentLogger } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { LlmStrategy, llm, memoryCache, mergePartials, modelIdOf, toUsage } from "../../src/llm/index.js";
import { createLlmExtractor } from "../../src/llm/index.js";
import { failingModel, mockModel } from "./mock-model.js";

const Invoice = z.object({
  invoiceNumber: z.string(),
  total: z.number(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
});

const PAGE_ONE = "Invoice Number: INV-1\nWidget A 10.00\nWidget B 20.00";
const PAGE_TWO = "Widget C 30.00\nTOTAL 60.00";

function threePageDoc(): ReturnType<typeof loadedDocument> {
  return loadedDocument([PAGE_ONE, PAGE_TWO, "Widget D 40.00"]);
}

describe("LlmStrategy", () => {
  it("extracts through the AI SDK and returns typed data", async () => {
    const { model, calls } = mockModel([
      { invoiceNumber: "INV-1", total: 60, lineItems: [{ description: "Widget A", amount: 10 }] },
    ]);

    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [llm({ model })],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);

    expect(result.data.invoiceNumber).toBe("INV-1");
    expect(result.method).toBe("llm");
    expect(calls).toHaveLength(1);
    expectTypeOf(result.data.lineItems).toEqualTypeOf<{ description: string; amount: number }[]>();
  });

  it("accepts a model instance, and reads its id for cost lookups", () => {
    const { model } = mockModel([{}], { modelId: "gpt-5-test" });
    expect(modelIdOf(model)).toBe("gpt-5-test");
    // A gateway model string is also a valid AI SDK LanguageModel.
    expect(modelIdOf("openai/gpt-5")).toBe("openai/gpt-5");
  });

  it("puts the document inside delimiters, so content cannot read as instruction", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "x", total: 1, lineItems: [] }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [llm({ model })],
    });

    await extractor.extract(new Uint8Array([1]), Invoice);

    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("<document>");
    expect(sent).toContain("Invoice Number: INV-1");
  });

  it("reports usage, and costs it when given a pricing table", async () => {
    const { model } = mockModel([{ invoiceNumber: "x", total: 1, lineItems: [] }], {
      modelId: "gpt-5",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [
        llm({ model, pricing: { "gpt-5": { inputPerMillion: 2, outputPerMillion: 10 } } }),
      ],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);

    expect(result.usage.inputTokens).toBe(1_000_000);
    // 1M input at $2 + 0.5M output at $10 = $7.
    expect(result.usage.costUsd).toBeCloseTo(7, 5);
  });

  it("leaves cost undefined rather than zero when it has no price", async () => {
    const { model } = mockModel([{ invoiceNumber: "x", total: 1, lineItems: [] }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [llm({ model })],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);
    // `0` would read as "this was free". It was not; we just do not know the price.
    expect(result.usage.costUsd).toBeUndefined();
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("is not eligible for a document with no text layer", async () => {
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([""], { geometry: false }))],
      strategies: [llm({ model: mockModel([{}]).model })],
    });

    await expect(extractor.extract(new Uint8Array([1]), Invoice)).rejects.toThrow(
      /no extraction strategy is eligible/i,
    );
  });

  it("lets a later strategy answer when the provider fails", async () => {
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [
        llm({ model: failingModel(), name: "broken-llm", maxRetries: 0 }),
        llm({ model: mockModel([{ invoiceNumber: "OK", total: 1, lineItems: [] }]).model, name: "working-llm" }),
      ],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);
    expect(result.method).toBe("working-llm");
    expect(result.data.invoiceNumber).toBe("OK");
    expect(result.attempts[0]).toMatchObject({ strategy: "broken-llm", status: "failed" });
  });
});

describe("completion strategies", () => {
  it("forbidden sends the whole document in one request", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-1", total: 60, lineItems: [] }]);
    const strategy = new LlmStrategy({ model, completion: "forbidden" });
    const extractor = createExtractor({
      loaders: [inMemoryLoader(threePageDoc())],
      strategies: [strategy],
    });

    await extractor.extract(new Uint8Array([1]), Invoice);
    expect(calls).toHaveLength(1);
  });

  it("paginate sends one request per page and merges the answers", async () => {
    const { model, calls } = mockModel([
      { invoiceNumber: "INV-1", total: 60, lineItems: [{ description: "A", amount: 10 }] },
      { invoiceNumber: null, total: null, lineItems: [{ description: "B", amount: 20 }] },
      { invoiceNumber: null, total: null, lineItems: [{ description: "C", amount: 30 }] },
    ]);

    const extractor = createExtractor({
      loaders: [inMemoryLoader(threePageDoc())],
      strategies: [llm({ model, completion: "paginate" })],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);

    expect(calls).toHaveLength(3);
    // Arrays concatenate…
    expect(result.data.lineItems.map((li) => li.description)).toEqual(["A", "B", "C"]);
    // …and the page that actually read the number keeps it.
    expect(result.data.invoiceNumber).toBe("INV-1");
    expect(result.data.total).toBe(60);
    // Usage sums across every request.
    expect(result.usage.totalTokens).toBe(3 * 125);
  });

  it("concatenate packs pages up to a character budget", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-1", total: 1, lineItems: [] }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(threePageDoc())],
      // Small budget: each page lands in its own request.
      strategies: [llm({ model, completion: "concatenate", maxCharsPerRequest: 20 })],
    });

    await extractor.extract(new Uint8Array([1]), Invoice);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("concatenate uses one request when everything fits", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-1", total: 1, lineItems: [] }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(threePageDoc())],
      strategies: [llm({ model, completion: "concatenate", maxCharsPerRequest: 100_000 })],
    });

    await extractor.extract(new Uint8Array([1]), Invoice);
    expect(calls).toHaveLength(1);
  });
});

describe("mergePartials", () => {
  it("concatenates arrays and keeps the first present scalar", () => {
    expect(
      mergePartials([
        { id: "A", rows: [1], note: null },
        { id: "B", rows: [2], note: "later" },
      ]),
    ).toEqual({ id: "A", rows: [1, 2], note: "later" });
  });

  it("does not let a later null overwrite a value that was read", () => {
    expect(mergePartials([{ total: 60 }, { total: null }])).toEqual({ total: 60 });
  });

  it("treats an empty string as absent, the way a model reports 'not found'", () => {
    expect(mergePartials([{ name: "" }, { name: "Acme" }])).toEqual({ name: "Acme" });
  });

  it("recurses into nested objects", () => {
    expect(
      mergePartials([
        { address: { city: "Berlin", zip: null } },
        { address: { city: null, zip: "10115" } },
      ]),
    ).toEqual({ address: { city: "Berlin", zip: "10115" } });
  });

  it("returns undefined for nothing usable", () => {
    expect(mergePartials([])).toBeUndefined();
    expect(mergePartials([null, undefined])).toBeUndefined();
  });
});

describe("response cache", () => {
  it("serves a repeat request from cache instead of calling the model", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "INV-1", total: 1, lineItems: [] }]);
    const cache = memoryCache();
    const loaders = [inMemoryLoader(loadedDocument([PAGE_ONE]))];
    const strategies = [llm({ model, cache })];

    const first = createExtractor({ loaders, strategies });
    await first.extract(new Uint8Array([1]), Invoice);
    expect(calls).toHaveLength(1);

    const second = createExtractor({ loaders, strategies });
    const result = await second.extract(new Uint8Array([1]), Invoice);
    expect(calls).toHaveLength(1); // no second request
    expect(result.data.invoiceNumber).toBe("INV-1");
  });

  it("misses when the schema changes, so a new shape is never served from an old answer", async () => {
    const { model, calls } = mockModel([
      { invoiceNumber: "INV-1", total: 1, lineItems: [] },
      { invoiceNumber: "INV-1" },
    ]);
    const cache = memoryCache();
    const loaders = [inMemoryLoader(loadedDocument([PAGE_ONE]))];

    const extractor = createExtractor({ loaders, strategies: [llm({ model, cache })] });
    await extractor.extract(new Uint8Array([1]), Invoice);
    await extractor.extract(new Uint8Array([1]), z.object({ invoiceNumber: z.string() }));

    expect(calls).toHaveLength(2);
  });
});

describe("toUsage", () => {
  it("collapses the AI SDK's undefined token counts to zero", () => {
    const usage = toUsage({ inputTokens: undefined, outputTokens: undefined }, 5);
    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, wallMs: 5 });
    expect(usage.costUsd).toBeUndefined();
  });

  it("derives totalTokens when the provider omits it", () => {
    expect(toUsage({ inputTokens: 10, outputTokens: 4 }, 1).totalTokens).toBe(14);
  });

  it("prices a gateway model string against a table keyed without the provider", () => {
    const usage = toUsage({ inputTokens: 1_000_000, outputTokens: 0 }, 1, "openai/gpt-5", {
      "gpt-5": { inputPerMillion: 3, outputPerMillion: 15 },
    });
    expect(usage.costUsd).toBeCloseTo(3, 5);
  });
});

describe("createLlmExtractor", () => {
  it("wires a model in one line", async () => {
    const { model } = mockModel([{ invoiceNumber: "INV-9", total: 5, lineItems: [] }]);
    const extractor = createLlmExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      model,
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);
    expect(result.data.invoiceNumber).toBe("INV-9");
    expect(result.method).toBe("llm");
  });

  it("puts deterministic strategies before the model", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "from-model", total: 1, lineItems: [] }]);
    const extractor = createLlmExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      model,
      before: [
        {
          name: "parser",
          async extract() {
            return { data: { invoiceNumber: "from-parser", total: 1, lineItems: [] } };
          },
        },
      ],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);

    // The free path won, and the model was never called.
    expect(result.method).toBe("parser");
    expect(result.data.invoiceNumber).toBe("from-parser");
    expect(calls).toHaveLength(0);
  });

  it("falls through to the model when the parser throws", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "from-model", total: 1, lineItems: [] }]);
    const extractor = createLlmExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      model,
      before: [
        {
          name: "parser",
          async extract() {
            throw new Error("layout not recognised");
          },
        },
      ],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);
    expect(result.method).toBe("llm");
    expect(calls).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ strategy: "parser", status: "failed" });
  });
});

describe("abort", () => {
  it("propagates a caller abort without trying the next strategy", async () => {
    const controller = new AbortController();
    const { model } = mockModel([{ invoiceNumber: "x", total: 1, lineItems: [] }]);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument([PAGE_ONE]))],
      strategies: [llm({ model })],
      logger: silentLogger,
    });

    controller.abort();
    await expect(
      extractor.extract(new Uint8Array([1]), Invoice, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
