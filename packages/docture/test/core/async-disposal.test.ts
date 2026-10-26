import { describe, expect, it } from "vitest";
import { createDocumentConverter, createExtractor, withRasterizer } from "../../src/core/index.js";
import { fakeLoader } from "./fakes.js";

describe("scope disposal", () => {
  it("disposes an extractor once when its scope exits", async () => {
    let disposals = 0;
    try {
      await using extractor = createExtractor({ loaders: [fakeLoader({ onDispose() { disposals++; } })] });
      expect(extractor.components.loaders).toHaveLength(1);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    expect(disposals).toBe(1);
  });

  it("disposes a converter once when its scope exits", async () => {
    let disposals = 0;
    try {
      await using converter = createDocumentConverter({ loaders: [fakeLoader({ onDispose() { disposals++; } })] });
      expect(converter).toBeDefined();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    expect(disposals).toBe(1);
  });

  it("disposes both parts of a composed loader when its scope exits", async () => {
    const disposals: string[] = [];
    try {
      await using composed = withRasterizer(fakeLoader({ onDispose() { disposals.push("loader"); } }), {
        name: "raster",
        formats: ["png"],
        async rasterize() { return []; },
        async dispose() { disposals.push("raster"); },
      });
      expect(composed.name).toBe("fake+raster");
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    expect(disposals).toEqual(["loader", "raster"]);
  });
});
