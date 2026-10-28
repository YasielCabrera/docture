import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, silentLogger, type LoadedPage } from "docture";
import { vision } from "docture/llm/vision";
import { ImageSplitter } from "docture/llm/split";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

function abortingPages(texts: readonly string[], abortOnCall: number, caller: AbortController) {
  const seen: (boolean | undefined)[] = [];
  const pages: LoadedPage[] = loadedDocument(texts).pages.map((page) => ({
    ...page,
    image: (_options, call) => {
      if (seen.length + 1 === abortOnCall) caller.abort();
      seen.push(call?.signal?.aborted);
      return Promise.resolve(PNG);
    },
  }));
  return { pages, seen };
}

function extractWith(pages: readonly LoadedPage[], answers: readonly unknown[], caller: AbortController) {
  const document = { ...loadedDocument(pages.map((page) => page.text)), pages };
  return createExtractor({
    loaders: [inMemoryLoader(document)],
    strategies: [vision({ model: mockModel(answers).model, maxRetries: 0 })],
  }).extract(new Uint8Array([1]), z.object({ value: z.string() }), { signal: caller.signal });
}

describe("page image calls follow the caller's signal", () => {
  it("passes the caller's signal to the first vision render", async () => {
    const caller = new AbortController();
    const { pages, seen } = abortingPages(["one"], 1, caller);

    await expect(extractWith(pages, [{ value: "ok" }], caller)).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([true]);
  });

  it("passes the caller's signal to the repair render", async () => {
    const caller = new AbortController();
    const { pages, seen } = abortingPages(["one"], 2, caller);

    await expect(extractWith(pages, [{ value: 123 }, { value: "ok" }], caller)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(seen).toEqual([false, true]);
  });

  it("passes the split signal to ImageSplitter renders", async () => {
    const caller = new AbortController();
    const { pages, seen } = abortingPages(["one", "two"], 1, caller);
    const { model } = mockModel([
      { belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 1 },
    ]);

    await new ImageSplitter({ model }).belongsToSameDocument(pages[0]!, pages[1]!, {
      classifications: [{ name: "invoice", description: "An invoice", schema: z.object({}) }],
      signal: caller.signal,
      logger: silentLogger,
    }).catch(() => undefined);
    expect(seen.slice(0, 2)).toEqual([true, true]);
  });
});
