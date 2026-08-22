/**
 * `Contract` — a schema that knows its own name.
 *
 * The claim under test is that naming a schema costs nothing: every call that takes
 * a contract still takes a bare schema, and the inferred output type is identical
 * either way.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  Extractor,
  contract,
  contractName,
  isContract,
  schemaOf,
  type Contract,
  type InferContract,
} from "../src/index.js";
import { PDF_BYTES, fakeLoader, fakeStrategy } from "./fakes.js";

const InvoiceSchema = z.object({
  invoiceNumber: z.string(),
  total: z.number(),
});

const Invoice = contract({
  name: "invoice",
  description: "A commercial invoice with a total.",
  schema: InvoiceSchema,
  hints: "The total is bottom-right.",
});

describe("contract()", () => {
  it("keeps the name, description and hints", () => {
    expect(Invoice.name).toBe("invoice");
    expect(Invoice.description).toBe("A commercial invoice with a total.");
    expect(Invoice.hints).toBe("The total is bottom-right.");
  });

  it("omits absent optional fields rather than setting them undefined", () => {
    const bare = contract({ name: "bare", schema: z.object({ a: z.string() }) });
    expect("description" in bare).toBe(false);
    expect("hints" in bare).toBe(false);
  });

  it("infers the output type from the schema", () => {
    expectTypeOf<InferContract<typeof Invoice>>().toEqualTypeOf<{
      invoiceNumber: string;
      total: number;
    }>();
  });

  it("infers the SAME type from the bare schema", () => {
    expectTypeOf<InferContract<typeof InvoiceSchema>>().toEqualTypeOf<
      InferContract<typeof Invoice>
    >();
  });
});

describe("isContract()", () => {
  it("recognises a contract", () => {
    expect(isContract(Invoice)).toBe(true);
  });

  it("recognises a hand-written one — no wrapper class required", () => {
    expect(isContract({ name: "manual", schema: InvoiceSchema })).toBe(true);
  });

  /**
   * The discrimination that makes `ContractLike` work at all. A Zod schema has no
   * `name`; a `LazySchema` is a function; a `Schema` has no `name` either.
   */
  it("does NOT mistake a Zod schema for a contract", () => {
    expect(isContract(InvoiceSchema)).toBe(false);
    expect(isContract(z.string())).toBe(false);
    expect(isContract(z.array(z.number()))).toBe(false);
  });

  it("does not mistake a function, an array or null for a contract", () => {
    expect(isContract(() => InvoiceSchema)).toBe(false);
    expect(isContract([1, 2])).toBe(false);
    expect(isContract(null)).toBe(false);
    expect(isContract(undefined)).toBe(false);
  });
});

describe("schemaOf() / contractName()", () => {
  it("unwraps a contract", () => {
    expect(schemaOf(Invoice)).toBe(InvoiceSchema);
    expect(contractName(Invoice)).toBe("invoice");
  });

  it("passes a bare schema straight through", () => {
    expect(schemaOf(InvoiceSchema)).toBe(InvoiceSchema);
    expect(contractName(InvoiceSchema)).toBeUndefined();
  });
});

describe("extracting against a contract", () => {
  const build = (): Extractor =>
    new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadStrategy(fakeStrategy({ data: { invoiceNumber: "INV-1", total: 42 } }));

  it("returns data typed from the contract, to its leaves", async () => {
    const result = await build().extract(PDF_BYTES, Invoice);
    expectTypeOf(result.data).toEqualTypeOf<{ invoiceNumber: string; total: number }>();
    expect(result.data.total).toBe(42);
  });

  it("returns the same shape for the bare schema", async () => {
    const result = await build().extract(PDF_BYTES, InvoiceSchema);
    expectTypeOf(result.data).toEqualTypeOf<{ invoiceNumber: string; total: number }>();
    expect(result.data.invoiceNumber).toBe("INV-1");
  });

  /**
   * A contract's name and description ARE prompt material, so extracting against one
   * should hand them to a strategy that asked for a classification — without the
   * caller repeating them in an options bag.
   */
  it("offers a lone contract to strategies as its own classification", async () => {
    let seen: readonly string[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier({
        name: "spy",
        async classify(ctx) {
          seen = ctx.candidates.map((c) => c.name);
          return null;
        },
      })
      .loadStrategy(
        fakeStrategy({
          data: { invoiceNumber: "INV-1", total: 1 },
          needsClassification: "hint",
        }),
      );

    await extractor.extract(PDF_BYTES, Invoice);
    expect(seen).toEqual(["invoice"]);
  });

  it("does not invent a classification for a bare schema", async () => {
    let seen: readonly string[] | undefined;
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier({
        name: "spy",
        async classify(ctx) {
          seen = ctx.candidates.map((c) => c.name);
          return null;
        },
      })
      .loadStrategy(
        fakeStrategy({ data: { invoiceNumber: "x", total: 1 }, needsClassification: "hint" }),
      );

    await extractor.extract(PDF_BYTES, InvoiceSchema);
    expect(seen).toEqual([]);
  });

  it("does not override classifications the caller wired", async () => {
    let seen: readonly string[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifications({ name: "receipt", description: "a receipt", schema: InvoiceSchema })
      .loadClassifier({
        name: "spy",
        async classify(ctx) {
          seen = ctx.candidates.map((c) => c.name);
          return null;
        },
      })
      .loadStrategy(
        fakeStrategy({ data: { invoiceNumber: "x", total: 1 }, needsClassification: "hint" }),
      );

    await extractor.extract(PDF_BYTES, Invoice);
    expect(seen).toEqual(["receipt"]);
  });
});

describe("Contract as a type", () => {
  it("is assignable from a plain object literal", () => {
    const manual: Contract<{ a: string }> = {
      name: "manual",
      schema: z.object({ a: z.string() }),
    };
    expect(manual.name).toBe("manual");
  });
});
