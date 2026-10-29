import { describe, expect, it } from "vitest";
import { z } from "zod";
import { constraint, defineModel, gen, isValidIban, isValidLuhn, scenario, streamFor, SynthesisError, typedJsonSchema, unique } from "../src/index.js";
import { Invoice, invoiceFields, invoiceModel, SELLERS, withTotals, type Invoice as InvoiceType } from "./fixtures.js";

describe("seeded streams", () => {
  it("give the same sequence for the same seed and key, and a different one otherwise", () => {
    const draw = (seed: number, key: string) => Array.from({ length: 4 }, (_, i) => streamFor(seed, key).fork(String(i)).int(0, 999));
    expect(draw(7, "a")).toEqual(draw(7, "a"));
    expect(draw(7, "a")).not.toEqual(draw(7, "b"));
    expect(draw(7, "a")).not.toEqual(draw(8, "a"));
    expect(streamFor(1, "x").int(5, 5)).toBe(5);
  });
});

describe("defineModel", () => {
  it("samples a schema-valid invoice whose totals reconcile", async () => {
    const { value, seed, scenario: name } = await invoiceModel.sample({ seed: 7 });
    expect(seed).toBe(7);
    expect(name).toBe("base");
    expect(Invoice.safeParse(value).success).toBe(true);
    expect(value.invoiceNumber).toMatch(/^INV-\d{6}$/u);
    expect(SELLERS).toContain(value.seller.name);
    expect(isValidIban(value.seller.iban)).toBe(true);
    expect(value.subtotalCents).toBe(value.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0));
    expect(value.totalCents).toBe(value.subtotalCents + Math.round(value.subtotalCents * 0.19));
    expect(value.dueAt > value.issuedAt).toBe(true);
  });

  it("is reproducible: the same seed gives a deep-equal sample, another seed a different one", async () => {
    const a = await invoiceModel.sample({ seed: 42 });
    const b = await invoiceModel.sample({ seed: 42 });
    const c = await invoiceModel.sample({ seed: 43 });
    expect(b.value).toEqual(a.value);
    expect(c.value).not.toEqual(a.value);
  });

  it("keeps every existing value when the schema gains a field", async () => {
    const Extended = Invoice.extend({ purchaseOrder: z.string(), buyer: Invoice.shape.buyer.extend({ reference: z.string() }) });
    const extended = defineModel(Extended, { fields: { ...invoiceFields, purchaseOrder: gen.pattern("PO-####") } as never, derive: withTotals as never });
    for (const seed of [1, 2, 3, 4, 5]) {
      const base = (await invoiceModel.sample({ seed })).value;
      const more = (await extended.sample({ seed })).value as InvoiceType & { purchaseOrder: string; buyer: { reference: string } };
      expect(more.purchaseOrder).toMatch(/^PO-\d{4}$/u);
      expect(typeof more.buyer.reference).toBe("string");
      const { purchaseOrder: _po, ...rest } = more;
      const { reference: _ref, ...buyer } = more.buyer;
      expect({ ...rest, buyer }).toEqual(base);
    }
  });

  it("lets a scenario override some positions while every other value stays the same", async () => {
    const manyLines = scenario<InvoiceType>({ name: "many-lines", tags: ["pagination"], fields: { lineItems: gen.array({ length: 101 }) } });
    const base = (await invoiceModel.sample({ seed: 9 })).value;
    const sample = await invoiceModel.sample({ seed: 9, scenario: manyLines });
    expect(sample.scenario).toBe("many-lines");
    expect(sample.tags).toEqual(["pagination"]);
    expect(sample.value.lineItems).toHaveLength(101);
    expect(sample.value.lineItems.slice(0, base.lineItems.length)).toEqual(base.lineItems);
    expect(sample.value.seller).toEqual(base.seller);
    expect(sample.value.invoiceNumber).toBe(base.invoiceNumber);
  });

  it("re-derives after a scenario's shape and checks its promise", async () => {
    const zeroTotal = scenario<InvoiceType>({
      name: "zero-total",
      shape: (value) => {
        const credit = { description: "Credit note", quantity: 1, unitPriceCents: -value.subtotalCents, amountCents: 0 };
        return { ...value, lineItems: [...value.lineItems, credit] };
      },
      expect: (value) => value.totalCents === 0 || `total is ${value.totalCents}`,
    });
    const { value } = await invoiceModel.sample({ seed: 3, scenario: zeroTotal });
    expect(value.totalCents).toBe(0);
    expect(value.taxCents).toBe(0);
    expect(value.lineItems.at(-1)?.description).toBe("Credit note");

    const broken = scenario<InvoiceType>({ name: "broken", expect: (value) => value.totalCents === -1 || `total is ${value.totalCents}` });
    const sample = invoiceModel.sample({ seed: 3, scenario: broken });
    await expect(sample).rejects.toThrow(SynthesisError);
    await expect(sample).rejects.toThrow(/scenario broken: total is \d+/u);
  });

  it("reconciles counts, negative totals, a half-cent tax and calendar boundaries", async () => {
    const lines = (length: number) => scenario<InvoiceType>({ name: `lines-${length}`, fields: { lineItems: gen.array({ length }) } });
    for (const length of [100, 101, 250]) {
      const { value } = await invoiceModel.sample({ seed: 4, scenario: lines(length) });
      expect(value.lineItems).toHaveLength(length);
      expect(value.subtotalCents).toBe(value.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0));
    }

    const reversed = scenario<InvoiceType>({
      name: "all-reversed",
      shape: (value) => ({ ...value, lineItems: value.lineItems.map((item) => ({ ...item, unitPriceCents: -item.unitPriceCents })) }),
    });
    const base = (await invoiceModel.sample({ seed: 4 })).value;
    const negative = (await invoiceModel.sample({ seed: 4, scenario: reversed })).value;
    expect(negative.subtotalCents).toBe(-base.subtotalCents);
    expect(negative.totalCents).toBe(negative.subtotalCents + Math.round(negative.subtotalCents * 0.19));

    const halfCent = scenario<InvoiceType>({ name: "half-cent", fields: { lineItems: gen.array({ length: 1 }), "lineItems[].quantity": gen.value(1), "lineItems[].unitPriceCents": gen.value(50) } });
    expect((await invoiceModel.sample({ seed: 4, scenario: halfCent })).value).toMatchObject({ subtotalCents: 50, taxCents: 10, totalCents: 60 });

    const boundary = (issuedAt: string) => scenario<InvoiceType>({ name: `issued-${issuedAt}`, fields: { issuedAt: gen.value(issuedAt), dueAt: gen.dateAfter("issuedAt", { days: 1 }) } });
    expect((await invoiceModel.sample({ seed: 4, scenario: boundary("2024-02-29") })).value).toMatchObject({ issuedAt: "2024-02-29", dueAt: "2024-03-01" });
    expect((await invoiceModel.sample({ seed: 4, scenario: boundary("2025-12-31") })).value).toMatchObject({ issuedAt: "2025-12-31", dueAt: "2026-01-01" });
    await expect(invoiceModel.sample({ seed: 4, scenario: boundary("2025-02-29") })).rejects.toThrow(new RangeError('"2025-02-29" is not an ISO date'));
  });

  it("drops an optional field with gen.absent and nulls a nullable one with gen.null", async () => {
    const lean = scenario<InvoiceType>({ name: "lean", fields: { "buyer.contact": gen.absent(), "seller.vatId": gen.absent(), note: gen.null() } });
    const { value } = await invoiceModel.sample({ seed: 5, scenario: lean });
    expect("contact" in value.buyer).toBe(false);
    expect("vatId" in value.seller).toBe(false);
    expect(value.note).toBeNull();
  });

  it("reports every violated constraint and schema issue by name", async () => {
    const model = defineModel(Invoice, {
      fields: { ...invoiceFields, "lineItems[].quantity": gen.value(0), "seller.iban": gen.value("DE00123") },
      derive: withTotals,
      constraints: [unique("lineItems[].description"), constraint("positive total", (value) => (value.totalCents > 0 ? undefined : "total must be positive"))],
    });
    const error = await model.sample({ seed: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SynthesisError);
    const problems = (error as SynthesisError).problems;
    expect(problems).toContainEqual({ path: "positive total", message: "total must be positive" });
    expect(problems.some((problem) => problem.path === "lineItems.0.quantity")).toBe(true);
  });

  it("fills unconfigured positions from the JSON Schema alone", async () => {
    const schema = typedJsonSchema<{ id: string; when: string; count: number; kind: "a" | "b"; tags: string[] }>({
      type: "object",
      required: ["id", "when", "count", "kind", "tags"],
      properties: {
        id: { type: "string", format: "uuid" },
        when: { type: "string", format: "date" },
        count: { type: "integer", minimum: 3, maximum: 5 },
        kind: { enum: ["a", "b"] },
        tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
      },
    });
    const { value } = await defineModel(schema).sample({ seed: "fixed" });
    expect(value.id).toMatch(/^\d{8}-\d{4}-4\d{3}-a\d{3}-\d{12}$/u);
    expect(value.when).toMatch(/^20(2[0-6])-\d\d-\d\d$/u);
    expect([3, 4, 5]).toContain(value.count);
    expect(["a", "b"]).toContain(value.kind);
    expect(value.tags).toHaveLength(2);
  });

  it("rejects a generator that depends on itself", async () => {
    const model = defineModel(Invoice, { fields: { ...invoiceFields, issuedAt: gen.dateAfter("dueAt", { days: 1 }) }, derive: withTotals });
    await expect(model.sample({ seed: 1 })).rejects.toThrow(/depends on itself/u);
  });
});

describe("check digits", () => {
  it("accepts known-valid identifiers and rejects altered ones", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE88370400440532013000")).toBe(false);
    expect(isValidLuhn("4539 1488 0343 6467")).toBe(true);
    expect(isValidLuhn("4539148803436468")).toBe(false);
  });
});
