import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DocumentConverter, Extractor } from "docture";

const schema = z.object({ text: z.string() });

describe("batch concurrency validation", () => {
  for (const concurrency of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
    it(`rejects extraction concurrency ${concurrency} before processing a source`, async () => {
      const extractor = new Extractor();
      const extract = vi.spyOn(extractor, "safeExtract");
      await expect(extractor.extractBatch([new Uint8Array([1])], schema, { concurrency }).next())
        .rejects.toThrow("concurrency must be a positive integer");
      expect(extract).not.toHaveBeenCalled();
    });

    it(`rejects conversion concurrency ${concurrency} before processing a source`, async () => {
      const converter = new DocumentConverter();
      const convert = vi.spyOn(converter, "safeConvert");
      await expect(converter.convertBatch([new Uint8Array([1])], { concurrency }).next())
        .rejects.toThrow("concurrency must be a positive integer");
      expect(convert).not.toHaveBeenCalled();
    });
  }

  it("accepts the default and positive integer concurrency for empty batches", async () => {
    for (const concurrency of [undefined, 1, 2, 10]) {
      const options = concurrency === undefined ? {} : { concurrency };
      expect(await new Extractor().extractBatch([], schema, options).next()).toEqual({ done: true, value: undefined });
      expect(await new DocumentConverter().convertBatch([], options).next()).toEqual({ done: true, value: undefined });
    }
  });
});
