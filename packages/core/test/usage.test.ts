import { expect, it } from "vitest";
import { z } from "zod";
import { Extractor, Process, SplittingStrategy, createDocumentConverter, defineClassification, type Splitter } from "../src/index.js";
import { PDF_BYTES, fakeLoader, fakeStrategy, multiPageDoc } from "./fakes.js";
import * as core from "../src/index.js";

it("sums reported counts without deriving missing totals", () => {
  expect(core.sumUsage([{ inputTokens: 10 }, { outputTokens: 2 }], 7)).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 0, wallMs: 7 });
});

it("preserves reported zero costs and cache counts with caller-supplied elapsed time", () => {
  expect(core.sumUsage([{ costUsd: 0, cacheReadTokens: 0, cacheWriteTokens: 0, wallMs: 100 }, { inputTokens: 10, wallMs: 200 }], 7))
    .toEqual({ inputTokens: 10, outputTokens: 0, totalTokens: 0, costUsd: 0, cacheReadTokens: 0, cacheWriteTokens: 0, wallMs: 7 });
});

it("sums reported costs when another part has no price", () => {
  expect(core.sumUsage([{ costUsd: 2 }, { inputTokens: 10 }], 7).costUsd).toBe(2);
});

it("preserves cache counters in Process split totals", async () => {
  const kind = defineClassification({ name: "invoice", description: "Invoice", schema: z.object({ value: z.string() }) });
  const splitter: Splitter = {
    name: "accounted",
    async belongsToSameDocument(_a, _b, ctx) {
      ctx.recordUsage?.({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 4, cacheWriteTokens: 2, costUsd: 1 });
      return { belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 1 };
    },
  };
  const extractor = new Extractor().loadDocumentLoader(fakeLoader({ document: multiPageDoc(["one", "two", "three"]) })).loadStrategy(fakeStrategy());
  const process = new Process().loadExtractor(extractor).loadSplitter(splitter).loadFile(PDF_BYTES).split([kind], SplittingStrategy.LAZY);
  await process.extract();
  expect(process.lastSplit?.usage).toMatchObject({ inputTokens: 20, outputTokens: 4, totalTokens: 24, cacheReadTokens: 8, cacheWriteTokens: 4, costUsd: 2 });
});

it("preserves layout cache counters during conversion normalization", async () => {
  const result = await createDocumentConverter({
    loaders: [fakeLoader()],
    layoutAnalyzer: { name: "accounted", async analyze() {
      return { annotations: [], usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 2, costUsd: 1 } };
    } },
  }).convert(PDF_BYTES);
  expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 4, cacheWriteTokens: 2, costUsd: 1 });
});
