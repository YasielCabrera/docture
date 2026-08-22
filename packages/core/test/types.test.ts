/**
 * The strong-typing claims, asserted rather than asserted-to.
 *
 * `expectTypeOf` and `@ts-expect-error` are checked by `pnpm typecheck`
 * (tsconfig.test.json includes this file), so a regression that only shows up in
 * the type system still breaks the build.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createExtractor,
  defineClassification,
  defineLoader,
  type ClassifiedExtraction,
  type DocumentLoader,
  type GeometryLoader,
  type ImageLoader,
  type TextLoader,
} from "../src/index.js";
import { PDF_BYTES, fakeStrategy, geometryCapableLoader, textOnlyLoader } from "./fakes.js";

describe("capability typing", () => {
  it("pins capability literals through defineLoader", () => {
    expectTypeOf(geometryCapableLoader.capabilities.geometry).toEqualTypeOf<true>();
    expectTypeOf(textOnlyLoader.capabilities.geometry).toEqualTypeOf<false>();
  });

  it("accepts a geometry-capable loader where geometry is required", () => {
    const accepted: GeometryLoader = geometryCapableLoader;
    expect(accepted.name).toBe("geometry-capable");
  });

  it("REJECTS a geometry-less loader where geometry is required", () => {
    // This is the payoff: a wiring mistake is a compile error at the call site,
    // not a throw halfway through someone's 400-page document.
    // @ts-expect-error — textOnlyLoader has `geometry: false`
    const rejected: GeometryLoader = textOnlyLoader;
    expect(rejected).toBeDefined();
  });

  it("REJECTS a non-rendering loader where images are required", () => {
    // @ts-expect-error — textOnlyLoader has `images: false`
    const rejected: ImageLoader = textOnlyLoader;
    expect(rejected).toBeDefined();
  });

  it("accepts either loader where only text is required", () => {
    const a: TextLoader = textOnlyLoader;
    const b: TextLoader = geometryCapableLoader;
    expect([a.name, b.name]).toHaveLength(2);
  });

  it("still accepts a plain object literal — no base class to extend", () => {
    const handWritten: DocumentLoader = {
      name: "hand-written",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["text/plain"] },
      async load(document) {
        const text = Buffer.from(document.bytes).toString("utf8");
        return {
          pages: [{ pageNumber: 1, width: 0, height: 0, text }],
          text,
          form: "digital",
          loader: "hand-written",
        };
      },
    };
    expect(handWritten.name).toBe("hand-written");
  });
});

describe("schema inference", () => {
  const Invoice = z.object({
    invoiceNumber: z.string(),
    total: z.number(),
    lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
  });

  it("infers nested types all the way to the leaves", async () => {
    const extractor = createExtractor({
      loaders: [geometryCapableLoader],
      strategies: [
        fakeStrategy({
          data: {
            invoiceNumber: "INV-1",
            total: 10,
            lineItems: [{ description: "widget", amount: 10 }],
          },
        }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Invoice);

    expectTypeOf(result.data).toEqualTypeOf<z.infer<typeof Invoice>>();
    expectTypeOf(result.data.lineItems).toEqualTypeOf<{ description: string; amount: number }[]>();
    expectTypeOf(result.data.lineItems[0]?.amount).toEqualTypeOf<number | undefined>();
    expect(result.data.lineItems[0]?.amount).toBe(10);
  });

  it("rejects reading a field the schema does not describe", async () => {
    const extractor = createExtractor({
      loaders: [geometryCapableLoader],
      strategies: [fakeStrategy({ data: { invoiceNumber: "x", total: 1, lineItems: [] } })],
    });
    const result = await extractor.extract(PDF_BYTES, Invoice);

    // @ts-expect-error — `vatNumber` is not in the schema
    expect(result.data.vatNumber).toBeUndefined();
  });
});

describe("classification narrows the extraction type", () => {
  const Invoice = z.object({ invoiceNumber: z.string() });
  const Receipt = z.object({ merchantName: z.string() });

  const invoice = defineClassification({
    name: "invoice",
    description: "A commercial invoice",
    schema: Invoice,
  });
  const receipt = defineClassification({
    name: "receipt",
    description: "A point-of-sale receipt",
    schema: Receipt,
  });

  it("pins the name to a literal", () => {
    expectTypeOf(invoice.name).toEqualTypeOf<"invoice">();
  });

  it("produces a discriminated union that narrows `data` from `name`", () => {
    type Result = ClassifiedExtraction<[typeof invoice, typeof receipt]>;

    expectTypeOf<Result["name"]>().toEqualTypeOf<"invoice" | "receipt">();

    const sample = { name: "invoice", data: { invoiceNumber: "INV-1" } } as Result;
    if (sample.name === "invoice") {
      expectTypeOf(sample.data).toEqualTypeOf<{ invoiceNumber: string }>();
      expect(sample.data.invoiceNumber).toBe("INV-1");
    } else {
      expectTypeOf(sample.data).toEqualTypeOf<{ merchantName: string }>();
    }
  });
});
