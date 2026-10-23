import { expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import * as core from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { TextSplitter, llm, llmClassifier, llmLayout, vision } from "../../src/llm/index.js";
import { mockModel } from "./mock-model.js";

const schema = z.object({ value: z.string() });
const pricing = { "mock-model": { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 } };
const loader = () => inMemoryLoader(loadedDocument(["Invoice INV-1 for widgets, total due 60.00 EUR, thank you."]));

it("passes non-schema errors through unchanged", async () => {
  const outage = new Error("429 provider unavailable");
  const successful = mockModel([{ value: "ok" }]);
  const generate = successful.model.doGenerate.bind(successful.model);
  let count = 0;
  successful.model.doGenerate = async (options) => {
    count += 1;
    if (count === 2) throw outage;
    return generate(options);
  };
  const document = loadedDocument(["one", "two"]);
  const strategy = llm({ model: successful.model, completion: "paginate", maxRetries: 0 });
  await expect(strategy.extract({
    document, features: core.preloadedFeatures({ loaded: document }), schema: await core.resolveSchema(schema),
    signal: new AbortController().signal, logger: core.silentLogger,
  })).rejects.toBe(outage);
  expect(count).toBe(2);
});

it("starts no fallback when cancellation overlaps invalid model output", async () => {
  const controller = new AbortController();
  const cancellation = new Error("user cancellation");
  const first = mockModel([{ value: 123 }]);
  const generate = first.model.doGenerate.bind(first.model);
  first.model.doGenerate = async (options) => {
    const response = await generate(options);
    controller.abort(cancellation);
    return response;
  };
  const second = mockModel([{ value: "ok" }]);
  const outcome = await core.createExtractor({ loaders: [loader()], strategies: [llm({ model: first.model, name: "first" }), llm({ model: second.model, name: "second" })] })
    .safeExtract(new Uint8Array([1]), schema, { signal: controller.signal });
  expect(outcome).toEqual({ ok: false, error: cancellation });
  expect(second.calls).toHaveLength(0);
});

it("counts schema-failed extraction calls before fallback", async () => {
  const first = mockModel([{ value: 123 }]);
  const second = mockModel([{ value: "ok" }]);
  const result = await core.createExtractor({
    loaders: [loader()],
    strategies: [llm({ name: "first", model: first.model, pricing }), llm({ name: "second", model: second.model, pricing })],
  }).extract(new Uint8Array([1]), schema);
  expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 50, totalTokens: 250, costUsd: 250 });
  expect(result.attempts[0]).toMatchObject({ strategy: "first", status: "failed", errorCode: "MODEL_OUTPUT_FAILED", usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 125 } });
});

it("retains each paid attempt when all strategies fail", async () => {
  const { model } = mockModel([{ value: 123 }]);
  const outcome = await core.createExtractor({ loaders: [loader()], strategies: [llm({ name: "a", model, pricing }), llm({ name: "b", model, pricing })] })
    .safeExtract(new Uint8Array([1]), schema);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected failed extraction");
  expect(outcome.error).toBeInstanceOf(core.ExtractionFailedError);
  if (!(outcome.error instanceof core.ExtractionFailedError)) throw outcome.error;
  expect(outcome.error.attempts.map(attempt => attempt.usage)).toEqual([
    expect.objectContaining({ inputTokens: 100, costUsd: 125 }),
    expect.objectContaining({ inputTokens: 100, costUsd: 125 }),
  ]);
});

it.each(["text", "vision"] as const)("retains prior successful %s chunks when a later chunk fails", async (kind) => {
  const pages = loadedDocument(["A first page with more than fifty characters of text to be extracted.", "A second page with more than fifty characters of text to be extracted."]);
  const document = { ...pages, pages: pages.pages.map(page => ({ ...page, image: async () => new Uint8Array([page.pageNumber]) })) };
  let generated = 0;
  const first = new MockLanguageModelV4({
    modelId: "mock-model", provider: "mock",
    async doGenerate() {
      generated += 1;
      return {
        content: [{ type: "text", text: generated === 1 ? '{"value":"ok"}' : "not JSON" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 25, text: 25, reasoning: 0 } },
        warnings: [],
      };
    },
  });
  const fallback = mockModel([{ value: "fallback" }]);
  const strategy = kind === "text"
    ? llm({ name: "multi", model: first, pricing, completion: "paginate" })
    : vision({ name: "multi", model: first, pricing, pageMode: "perPage" });
  const result = await core.createExtractor({ loaders: [inMemoryLoader(document)], strategies: [strategy, llm({ model: fallback.model, pricing })] })
    .extract({ loaded: document }, schema);
  expect(first.doGenerateCalls).toHaveLength(2);
  expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 75, totalTokens: 375, costUsd: 375 });
  expect(result.attempts[0]?.usage).toMatchObject({ inputTokens: 200, costUsd: 250 });
});

it("keeps failed classifier usage on its abstention", async () => {
  const handle = mockModel([{ name: "invoice", confidence: "bad", reason: "Invoice" }, { value: "ok" }]);
  const result = await core.createExtractor({
    loaders: [loader()], classifiers: [llmClassifier({ model: handle.model, pricing })], classifications: [{ name: "invoice", description: "Invoice", schema }],
    strategies: [llm({ model: handle.model, pricing })],
  }).extract(new Uint8Array([1]), schema);
  expect(result.classification?.name).toBe("UNKNOWN");
  expect(result.classification?.signals[0]?.usage).toMatchObject({ inputTokens: 100, costUsd: 125 });
  expect(result.usage).toMatchObject({ inputTokens: 200, costUsd: 250 });
});

it("retains failed layout usage while conversion falls back", async () => {
  const { model } = mockModel([{ annotations: "bad" }]);
  const result = await core.createDocumentConverter({ loaders: [loader()], layoutAnalyzer: llmLayout({ model, pricing }) })
    .convert(new Uint8Array([1]));
  expect(result.method).toBe("deterministic");
  expect(result.usage).toMatchObject({ inputTokens: 100, costUsd: 125 });
  expect(result.attempts.at(-1)).toMatchObject({ status: "failed", errorCode: "MODEL_OUTPUT_FAILED", usage: { inputTokens: 100, costUsd: 125 } });
});

it("records failed split usage and preserves the SDK cause", async () => {
  const { model } = mockModel([{ belongsToSameDocument: "bad" }]);
  const pages = loadedDocument(["one", "two"]).pages;
  const recordUsage = vi.fn();
  const first = pages[0];
  const second = pages[1];
  if (first === undefined || second === undefined) throw new Error("Expected two pages");
  const failure = await new TextSplitter({ model, pricing }).belongsToSameDocument(first, second, {
    classifications: [{ name: "invoice", description: "Invoice", schema }], signal: new AbortController().signal, logger: core.silentLogger, recordUsage,
  }).catch((error: unknown) => error);
  expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 100, costUsd: 125 }));
  expect(failure).toBeInstanceOf(core.ModelOutputError);
  if (!(failure instanceof core.ModelOutputError)) throw new Error("Expected model output failure");
  expect(NoObjectGeneratedError.isInstance(failure.cause)).toBe(true);
  expect(failure.usage).toMatchObject({ inputTokens: 100, costUsd: 125 });
});
