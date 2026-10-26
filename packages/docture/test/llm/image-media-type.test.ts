import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MockLanguageModelV4 } from "ai/test";
import { createExtractor, defineClassification, silentLogger, type LoadedPage, type RasterOptions } from "docture";
import { vision } from "docture/llm/vision";
import { ImageSplitter } from "docture/llm/split";
import { mockModel } from "./mock-model.js";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function imagePage(pageNumber: number, formats: (RasterOptions["format"] | undefined)[]): LoadedPage {
  return {
    pageNumber, width: 200, height: 300, text: "",
    async image(options) {
      formats.push(options?.format);
      return jpeg;
    },
  };
}

function sentFiles(model: MockLanguageModelV4) {
  return model.doGenerateCalls.flatMap((call) => call.prompt.flatMap((message) =>
    message.role === "user" ? message.content.flatMap((part) => part.type === "file" ? [{
      mediaType: part.mediaType,
      signature: part.data.type === "data" && part.data.data instanceof Uint8Array
        ? Array.from(part.data.data.slice(0, 3)) : part.data,
    }] : []) : []));
}

describe("encoded image media types", () => {
  it("sends JPEG vision bytes as image/jpeg when PNG was requested", async () => {
    const formats: (RasterOptions["format"] | undefined)[] = [];
    const page = imagePage(1, formats);
    const { model } = mockModel([{ value: "ok" }]);
    const extractor = createExtractor({
      loaders: [{
        name: "jpeg-page",
        capabilities: { text: false, geometry: false, images: true, mimeTypes: ["*/*"] },
        async load() { return { loader: "jpeg-page", form: "scanned", text: "", pages: [page] }; },
      }],
      strategies: [vision({ model })],
    });
    const result = await extractor.extract(new Uint8Array([1]), z.object({ value: z.string() }));
    expect(result.data).toEqual({ value: "ok" });
    expect(formats).toEqual(["png"]);
    expect(sentFiles(model)).toEqual([{ mediaType: "image/jpeg", signature: [255, 216, 255] }]);
  });

  it("sends JPEG splitter bytes as image/jpeg when PNG was requested", async () => {
    const formats: (RasterOptions["format"] | undefined)[] = [];
    const first = imagePage(1, formats);
    const second = imagePage(2, formats);
    const { model } = mockModel([{
      belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 1,
    }]);
    const result = await new ImageSplitter({ model }).belongsToSameDocument(first, second, {
      classifications: [defineClassification({ name: "invoice", description: "Invoice", schema: z.object({}) })],
      signal: new AbortController().signal,
      logger: silentLogger,
    });
    expect(result).toEqual({
      belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 1,
    });
    expect(formats).toEqual(["png", "png"]);
    expect(sentFiles(model)).toEqual([
      { mediaType: "image/jpeg", signature: [255, 216, 255] },
      { mediaType: "image/jpeg", signature: [255, 216, 255] },
    ]);
  });
});
