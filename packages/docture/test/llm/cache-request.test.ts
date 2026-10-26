import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { z } from "zod";
import { createExtractor } from "docture";
import { memoryCache } from "docture/llm/cache";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const loaders = () => [inMemoryLoader(loadedDocument([
  "Invoice INV-1 for widgets, total due 60.00 EUR, thank you.",
]))];

it("separates cached answers from providers sharing a model id", async () => {
  const cache = memoryCache();
  const answers: string[] = [];
  const counts: number[] = [];
  for (const provider of ["openai.chat", "azure.chat"]) {
    const handle = mockModel([{ who: provider }], { modelId: "gpt-4o" });
    const model = new MockLanguageModelV4({ provider, modelId: "gpt-4o", doGenerate: handle.model.doGenerate });
    const result = await createExtractor({ loaders: loaders(), strategies: [llm({ model, cache })] })
      .extract(new Uint8Array([1]), z.object({ who: z.string() }));
    answers.push(result.data.who);
    counts.push(handle.calls.length);
  }
  expect(answers).toEqual(["openai.chat", "azure.chat"]);
  expect(counts).toEqual([1, 1]);
});

it("separates cached answers by temperature and shares unset with zero", async () => {
  const cache = memoryCache();
  const { model, calls } = mockModel([{ total: 1 }, { total: 2 }]);
  const answers: number[] = [];
  for (const temperature of [undefined, 0, 0.7]) {
    const result = await createExtractor({
      loaders: loaders(),
      strategies: [llm({ model, cache, ...(temperature === undefined ? {} : { temperature }) })],
    }).extract(new Uint8Array([1]), z.object({ total: z.number() }));
    answers.push(result.data.total);
  }
  expect(answers).toEqual([1, 1, 2]);
  expect(calls).toHaveLength(2);
});
