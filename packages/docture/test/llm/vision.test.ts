import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contract, createExtractor, withRasterizer, type Rasterizer } from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { relaxJsonSchema, vision } from "../../src/llm/index.js";
import { mockModel } from "./mock-model.js";

const Invoice = z.object({
  invoiceNumber: z.string(),
  total: z.number(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
});

/** A rasterizer that returns a tiny valid PNG for any page asked for. */
function stubRasterizer(): Rasterizer & { calls: number[] } {
  const calls: number[] = [];
  return {
    name: "stub-raster",
    formats: ["png"],
    calls,
    async rasterize(_document, options) {
      const pages = options.pages ?? [1];
      calls.push(...pages);
      return pages.map((pageNumber) => ({
        pageNumber,
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        widthPx: 100,
        heightPx: 140,
        format: "png" as const,
        scale: 1,
      }));
    },
  };
}

describe("VisionStrategy", () => {
  it("sends contract hints before vision strategy hints in the system prompt", async () => {
    const { model, calls } = mockModel([{ total: 60 }]);
    const extractor = createExtractor({
      loaders: [withRasterizer(inMemoryLoader(loadedDocument(["Invoice page"])), stubRasterizer())],
      strategies: [vision({ model, hints: { UNKNOWN: "VISION_HINT" } })],
    });
    const result = await extractor.extract(new Uint8Array([1]), contract({
      name: "invoice", hints: "CONTRACT_HINT", schema: z.object({ total: z.number() }),
    }));
    expect(result.data).toEqual({ total: 60 });
    expect(JSON.stringify(calls[0]?.prompt)).toContain("CONTRACT_HINT\\nVISION_HINT");
  });

  it("is not a candidate unless the loader can render pages", async () => {
    // A plain text loader: images: false, so RENDERABLE_PAGES does not hold.
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["some text on the page here"]))],
      strategies: [vision({ model: mockModel([{}]).model })],
    });

    await expect(extractor.extract(new Uint8Array([1]), Invoice)).rejects.toThrow(
      /no extraction strategy is eligible/i,
    );
  });

  it("sends page images to the model", async () => {
    const { model, calls } = mockModel([
      { invoiceNumber: "INV-VIS", total: 42, lineItems: [] },
    ]);
    const raster = stubRasterizer();
    const loader = withRasterizer(inMemoryLoader(loadedDocument(["page one text"])), raster);

    const extractor = createExtractor({
      loaders: [loader],
      strategies: [vision({ model, dpi: 100 })],
    });

    const result = await extractor.extract(new Uint8Array([1]), Invoice);

    expect(result.data.invoiceNumber).toBe("INV-VIS");
    expect(raster.calls).toEqual([1]);

    // The request carried an image part alongside the text.
    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("image/png");
  });

  it("sends every page in one request by default", async () => {
    const { model, calls } = mockModel([{ invoiceNumber: "A", total: 1, lineItems: [] }]);
    const raster = stubRasterizer();
    const loader = withRasterizer(
      inMemoryLoader(loadedDocument(["one", "two", "three"])),
      raster,
    );

    await createExtractor({ loaders: [loader], strategies: [vision({ model })] }).extract(
      new Uint8Array([1]),
      Invoice,
    );

    expect(calls).toHaveLength(1);
    expect(raster.calls.sort()).toEqual([1, 2, 3]);
  });

  it("sends one request per page under perPage, and merges", async () => {
    const { model, calls } = mockModel([
      { invoiceNumber: "INV-1", lineItems: [{ description: "A", amount: 1 }] },
      { lineItems: [{ description: "B", amount: 2 }] },
      { total: 3, lineItems: [{ description: "C", amount: 3 }] },
    ]);
    const loader = withRasterizer(
      inMemoryLoader(loadedDocument(["one", "two", "three"])),
      stubRasterizer(),
    );

    const result = await createExtractor({
      loaders: [loader],
      strategies: [vision({ model, pageMode: "perPage" })],
    }).extract(new Uint8Array([1]), Invoice);

    expect(calls).toHaveLength(3);
    expect(result.data.lineItems.map((li) => li.description)).toEqual(["A", "B", "C"]);
    expect(result.data.invoiceNumber).toBe("INV-1");
    expect(result.data.total).toBe(3);
  });

  it("honours maxPages", async () => {
    const { model } = mockModel([{ invoiceNumber: "A", total: 1, lineItems: [] }]);
    const raster = stubRasterizer();
    const loader = withRasterizer(
      inMemoryLoader(loadedDocument(["one", "two", "three"])),
      raster,
    );

    await createExtractor({
      loaders: [loader],
      strategies: [vision({ model, maxPages: 2 })],
    }).extract(new Uint8Array([1]), Invoice);

    expect(raster.calls.sort()).toEqual([1, 2]);
  });

  it("works over a real PDF rendered by a real rasterizer", async () => {
    const { model } = mockModel([
      { invoiceNumber: "INV-REAL", total: 99, lineItems: [{ description: "X", amount: 99 }] },
    ]);
    const raster = stubRasterizer();
    const loader = withRasterizer(new DocumentLoaderPdfJs(), raster);
    const pdf = await makeInvoicePdf({ seed: 501 });

    const result = await createExtractor({
      loaders: [loader],
      strategies: [vision({ model })],
    }).extract(pdf.bytes, Invoice);

    expect(result.data.invoiceNumber).toBe("INV-REAL");
    expect(result.method).toBe("vision");
  });
});

describe("relaxJsonSchema", () => {
  it("drops required while keeping types and descriptions", () => {
    const relaxed = relaxJsonSchema({
      type: "object",
      required: ["a", "b"],
      properties: {
        a: { type: "string", description: "keep me" },
        b: { type: "object", required: ["c"], properties: { c: { type: "number" } } },
      },
    }) as Record<string, unknown>;

    expect(relaxed.required).toBeUndefined();
    expect(relaxed).toMatchObject({
      type: "object",
      properties: {
        a: { type: "string", description: "keep me" },
        b: { type: "object", properties: { c: { type: "number" } } },
      },
    });
    expect((relaxed.properties as Record<string, Record<string, unknown>>).b?.required).toBeUndefined();
  });

  it("recurses through arrays", () => {
    const relaxed = relaxJsonSchema({
      type: "array",
      items: { type: "object", required: ["x"], properties: { x: { type: "number" } } },
    }) as Record<string, Record<string, unknown>>;

    expect(relaxed.items?.required).toBeUndefined();
    expect(relaxed.items?.type).toBe("object");
  });

  it("leaves scalars and nulls alone", () => {
    expect(relaxJsonSchema("string")).toBe("string");
    expect(relaxJsonSchema(null)).toBeNull();
    expect(relaxJsonSchema(7)).toBe(7);
  });
});
