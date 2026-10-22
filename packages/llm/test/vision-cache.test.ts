import { expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, withRasterizer, type Rasterizer } from "@docture/core";
import { inMemoryLoader, loadedDocument } from "@docture/testing";
import { memoryCache, vision } from "../src/index.js";
import { mockModel } from "./mock-model.js";

const raster: Rasterizer = {
  name: "document-bytes",
  formats: ["png"],
  async rasterize(doc, options) {
    return (options.pages ?? [1]).map((pageNumber) => ({
      pageNumber,
      bytes: new Uint8Array([doc.bytes[0] ?? 0, options.maxEdge ?? 0]),
      widthPx: 1,
      heightPx: 1,
      format: "png" as const,
      scale: 1,
    }));
  },
};
const schema = z.object({ source: z.string() });

function setup() {
  const { model, calls } = mockModel([{ source: "FROM-DOC-A" }, { source: "FROM-DOC-B" }]);
  const cache = memoryCache();
  const make = (maxEdge?: number) => createExtractor({
    loaders: [withRasterizer(inMemoryLoader(loadedDocument(["x"])), raster)],
    strategies: [vision({ model, cache, ...(maxEdge === undefined ? {} : { maxEdge }) })],
  });
  return { calls, make };
}

it("separates documents with different rendered bytes", async () => {
  const { make, calls } = setup();
  const extractor = make();
  const a = await extractor.extract(new Uint8Array([0xa]), schema);
  const b = await extractor.extract(new Uint8Array([0xb]), schema);
  expect([a.data.source, b.data.source]).toEqual(["FROM-DOC-A", "FROM-DOC-B"]);
  expect(calls).toHaveLength(2);
});

it("separates rendered maxEdge variants", async () => {
  const { make, calls } = setup();
  const small = await make(1000).extract(new Uint8Array([1]), schema);
  const large = await make(2000).extract(new Uint8Array([1]), schema);
  expect([small.data.source, large.data.source]).toEqual(["FROM-DOC-A", "FROM-DOC-B"]);
  expect(calls).toHaveLength(2);
});

it("reuses identical rendered content", async () => {
  const { make, calls } = setup();
  const extractor = make();
  await extractor.extract(new Uint8Array([1]), schema);
  const repeated = await extractor.extract(new Uint8Array([1]), schema);
  expect(repeated.data.source).toBe("FROM-DOC-A");
  expect(calls).toHaveLength(1);
});
