import { DoctureError, contract } from "docture";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EvalSpecError, byIndex, defineComparator, defineEval, exact, hungarian, number, setOf, sumOf, text, type SpecProblem } from "../src/index.js";
import { Invoice, invoice, invoiceRules, invoiceSpec } from "./support/invoice.js";

function problemsOf(build: () => unknown): [string, string][] {
  try {
    build();
  } catch (error) {
    if (error instanceof EvalSpecError) return error.problems.map((problem: SpecProblem) => [problem.code, problem.path]);
    throw error;
  }
  throw new Error("expected an EvalSpecError");
}

const Order = z.object({
  customer: z.string(),
  placedAt: z.iso.datetime(),
  express: z.boolean(),
  totals: z.object({ net: z.number(), gross: z.number() }),
  items: z.array(z.object({ name: z.string(), qty: z.int() })),
});

describe("defineEval resolution", () => {
  it("fails closed with one error that lists every problem", () => {
    const build = () => defineEval(Order, {
      segments: { header: ["customer", "placedAt"], money: "totals.**" },
      fields: { "totals.tax": number(), "items[].name": text({ minSimilarity: 0.8 }) },
      arrays: { lines: byIndex() },
    });
    expect(problemsOf(build)).toEqual([
      ["unresolved-field", "customer"],
      ["unsegmented-field", "express"],
      ["unsegmented-field", "items[].name"],
      ["unsegmented-field", "items[].qty"],
      ["unresolved-array", "items"],
      ["unmatched-rule", "totals.tax"],
      ["unmatched-rule", "lines"],
    ]);
    expect(build).toThrow(/The eval spec has 7 problems:\n {2}- customer: no comparator for this string/u);
  });

  it("is a DoctureError recognized by its identity", () => {
    let caught: unknown;
    try {
      defineEval(Order, {});
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof DoctureError).toBe(true);
    expect((caught as EvalSpecError).code).toBe("EVAL_SPEC_INVALID");
    class ForeignCopy extends Error {
      static readonly doctureErrorIdentity = "EvalSpecError";
    }
    expect(new ForeignCopy("from another installed copy") instanceof EvalSpecError).toBe(true);
  });

  it("picks the comparator from the most specific rule, then the annotation, then the type default, then strings", () => {
    const spec = defineEval(Invoice, { ...invoiceRules, fields: { ...invoiceRules.fields, "totals.total": number({ abs: 0 }) } });
    expect([
      spec.explain("totals.total"),
      spec.explain("totals.net"),
      spec.explain("reference"),
      spec.explain("issueDate"),
      spec.explain("issuer"),
      spec.explain("lineItems[3].amount"),
      spec.explain("lineItems"),
      spec.explain("lineItems[].sku"),
      spec.explain("missing.path"),
    ]).toEqual([
      "totals.total: number(abs 0) from rule 'totals.total'; segment totals",
      "totals.net: number(abs 0.01) from rule 'totals.*'; segment totals",
      "reference: identifier() from x-docture-eval annotation; segment header",
      "issueDate: date(granularity day) from type default (date); segment header",
      "issuer: text(minSimilarity 0.9) from the strings default; segment header",
      "lineItems[].amount: number(abs 0) from type default (number); segment lineItems",
      "lineItems: hungarian(key sku; minSimilarity 0.5) from rule 'lineItems'",
      "lineItems[].sku: identifier() from rule 'lineItems[].sku'; critical; segment lineItems",
      "missing.path: not a path of this spec",
    ]);
  });

  it("reports equally specific rules as ambiguous", () => {
    expect(problemsOf(() => defineEval(Order, {
      strings: text({ minSimilarity: 0.9 }),
      fields: { "totals.*": number({ abs: 0.01 }), "*.net": number({ abs: 1 }) },
      arrays: { items: byIndex() },
    }))).toEqual([["ambiguous-rule", "totals.net"]]);
  });

  it("reads annotations from Zod metadata and rejects invalid ones", () => {
    const Annotated = z.object({
      amount: z.number().meta({ "x-docture-eval": { compare: "number", abs: 0.5, weight: 3, critical: true } }),
      code: z.string().meta({ "x-docture-eval": { compare: "fuzzy" } }),
      rows: z.array(z.object({ id: z.string() })).meta({ "x-docture-eval": { align: "hungarian", key: ["id"] } }),
    });
    expect(problemsOf(() => defineEval(Annotated, { strings: exact() }))).toEqual([["invalid-annotation", "code"]]);
    const Valid = Annotated.extend({ code: z.string() });
    const spec = defineEval(Valid, { strings: exact() });
    expect([spec.explain("amount"), spec.explain("rows")]).toEqual([
      "amount: number(abs 0.5) from x-docture-eval annotation; weight 3; critical",
      "rows: hungarian(key id; minSimilarity 0.5) from x-docture-eval annotation",
    ]);
  });

  it("compares an object or array as one value when an exact rule names it", () => {
    const Tagged = z.object({ tags: z.array(z.string()), meta: z.object({ a: z.string() }) });
    const spec = defineEval(Tagged, { fields: { tags: setOf(text({ minSimilarity: 1 })), meta: exact() } });
    expect(spec.info.fields.map((field) => [field.pattern, field.type, field.comparatorId])).toEqual([["tags", "array", "setOf"], ["meta", "object", "exact"]]);
    expect(spec.score({ tags: ["b", "a"], meta: { a: "x" } }, { tags: ["a", "b"], meta: { a: "y" } }).fields.map((field) => [field.path, field.status])).toEqual([
      ["tags", "match"],
      ["meta", "mismatch"],
    ]);
  });

  it("checks that assertion paths exist in the schema", () => {
    expect(problemsOf(() => defineEval(Invoice, { ...invoiceRules, assertions: [sumOf("lineItems[].price").equals("totals.total")] }))).toEqual([
      ["unknown-path", "lineItems[].price"],
    ]);
  });

  it("accepts a Docture contract, an AI SDK schema object and plain JSON Schema", () => {
    const rules = { strings: text({ minSimilarity: 0.9 }) };
    const json = { type: "object", properties: { name: { type: "string" }, total: { type: "number" } } };
    const aiSdkSchema = { [Symbol.for("vercel.ai.schema")]: true, jsonSchema: json, validate: undefined };
    const fromContract = defineEval(contract({ name: "receipt", schema: z.object({ name: z.string(), total: z.number() }) }), rules);
    const fromJson = defineEval(json, rules);
    const fromAiSdk = defineEval(aiSdkSchema, rules);
    expect([fromContract.fingerprint === fromJson.fingerprint, fromAiSdk.fingerprint === fromJson.fingerprint]).toEqual([true, true]);
    expect(fromJson.info.fields.map((field) => field.comparator)).toEqual(["text(minSimilarity 0.9)", "number(abs 0)"]);
  });

  it("explains how to pass a schema that cannot produce JSON Schema", () => {
    const legacy = { "~standard": { vendor: "zod", version: 1, validate: () => ({ value: {} }) } };
    expect(() => defineEval(legacy as never, {})).toThrow('the zod schema cannot produce JSON Schema. Zod 3 and Zod 4.1 schemas need wrapping, for example zodSchema(schema) from "ai", or pass JSON Schema');
  });

  it("requires a rule for the unknown keys of an object that allows them", () => {
    const Open = {
      type: "object",
      properties: { meta: { type: "object", properties: { source: { type: "string" } }, additionalProperties: true } },
      required: ["meta"],
      additionalProperties: false,
    };
    expect(problemsOf(() => defineEval(Open, { strings: exact() }))).toEqual([["open-object", "meta"]]);
    expect(() => defineEval(Open, { strings: exact() })).toThrow("meta: this object allows keys the schema does not name; add a rule 'meta.*' to compare them, compare the object as one value with a rule for 'meta', or close it with additionalProperties: false");
    const keys = defineEval(Open, { strings: exact(), fields: { "meta.*": exact() } });
    expect(keys.score({ meta: { source: "scan", pages: 2 } }, { meta: { source: "scan", pages: 3, lang: "de" } }).fields.map((field) => [field.path, field.status])).toEqual([
      ["meta.source", "match"], ["meta.pages", "mismatch"], ["meta.lang", "hallucination"],
    ]);
    expect(keys.validate({ meta: { source: "scan", pages: 2 } })).toEqual({ ok: true, value: { meta: { source: "scan", pages: 2 } } });
    const whole = defineEval(Open, { fields: { meta: exact() } });
    expect(whole.score({ meta: { source: "scan", pages: 2 } }, { meta: { source: "scan", pages: 3 } }).fields.map((field) => [field.path, field.status])).toEqual([["meta", "mismatch"]]);
  });

  it("refuses to align rows by similarity when every row field compares asynchronously", async () => {
    const slow = defineComparator({ id: "slow", async: true, compare: async (expected, actual) => ({ match: expected === actual, similarity: expected === actual ? 1 : 0 }) });
    const Rows = z.object({ rows: z.array(z.object({ name: z.string() })) });
    expect(problemsOf(() => defineEval(Rows, { strings: slow, arrays: { rows: hungarian() } }))).toEqual([["unalignable-array", "rows"]]);
    expect(() => defineEval(Rows, { strings: slow, arrays: { rows: hungarian() } })).toThrow("rows: rows have no field with a synchronous comparator and a weight above 0, so alignment cannot pair them by content; use byIndex() or give a row field a synchronous comparator");
    const indexed = defineEval(Rows, { strings: slow, arrays: { rows: byIndex() } });
    expect((await indexed.scoreAsync({ rows: [{ name: "a" }] }, { rows: [{ name: "a" }] })).metrics.exact).toBe(true);
  });

  it("aligns rows by what nested arrays hold", async () => {
    const Matrix = z.object({ rows: z.array(z.array(z.number())) });
    const matrix = defineEval(Matrix, { arrays: { rows: hungarian(), "rows[]": byIndex() } });
    const score = matrix.score({ rows: [[1, 2], [3, 4]] }, { rows: [[3, 4], [1, 2]] });
    expect([score.arrays[0]?.matched, score.arrays[0]?.outOfOrder, score.metrics.exact]).toEqual([2, 1, true]);
    const Tagged = z.object({ notes: z.array(z.object({ tags: z.array(z.string()) })) });
    const tagged = defineEval(Tagged, { strings: exact(), arrays: { notes: hungarian(), "notes[].tags": hungarian() } });
    const notes = tagged.score({ notes: [{ tags: ["a", "b"] }, { tags: ["c"] }] }, { notes: [{ tags: ["c"] }, { tags: ["b", "a"] }] });
    expect([notes.arrays[0]?.matched, notes.metrics.exact]).toEqual([2, true]);
  });

  it("fingerprints a canonical description that ignores property order and covers constraints and assertion options", () => {
    const schema = (properties: Record<string, unknown>) => ({ type: "object", properties, additionalProperties: false });
    const ab = defineEval(schema({ a: { type: "number" }, b: { type: "string", enum: ["x", "y"] } }));
    const ba = defineEval(schema({ b: { type: "string", enum: ["x", "y"] }, a: { type: "number" } }));
    const moreValues = defineEval(schema({ a: { type: "number" }, b: { type: "string", enum: ["x", "y", "z"] } }));
    const nullable = defineEval(schema({ a: { type: ["number", "null"] }, b: { type: "string", enum: ["x", "y"] } }));
    expect([ba.fingerprint === ab.fingerprint, moreValues.fingerprint === ab.fingerprint, nullable.fingerprint === ab.fingerprint]).toEqual([true, false, false]);
    const tight = defineEval(Invoice, { ...invoiceRules, assertions: [sumOf("lineItems[].amount").equals("totals.net", { abs: 0.01 })] });
    const loose = defineEval(Invoice, { ...invoiceRules, assertions: [sumOf("lineItems[].amount").equals("totals.net", { abs: 1 })] });
    expect(tight.fingerprint === loose.fingerprint).toBe(false);
  });

  it("fingerprints equal specs equally and changed tolerances differently", () => {
    const again = defineEval(Invoice, invoiceRules);
    const looser = defineEval(Invoice, { ...invoiceRules, fields: { ...invoiceRules.fields, "totals.*": number({ abs: 0.05 }) } });
    expect(invoiceSpec.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect([again.fingerprint === invoiceSpec.fingerprint, looser.fingerprint === invoiceSpec.fingerprint]).toEqual([true, false]);
  });
});

describe("spec.validate", () => {
  it("accepts valid ground truth", () => {
    const value = invoice();
    expect(invoiceSpec.validate(value)).toEqual({ ok: true, value });
  });

  it("rejects unknown keys, wrong leaf types, invalid values, empty rows and failed assertions together", () => {
    const result = invoiceSpec.validate({
      ...invoice(),
      extra: 1,
      issueDate: "2024-13-01",
      status: "late",
      totals: { net: "30", tax: 5.7, total: 35.7 },
      lineItems: [{ sku: "A-100", description: "Steel bolts", amount: 10 }, { sku: null, description: " ", amount: null }],
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        { code: "invalid-value", path: "issueDate", message: "expected a date in an accepted layout" },
        { code: "invalid-value", path: "status", message: 'expected one of "paid", "due", got "late"' },
        { code: "wrong-type", path: "totals.net", message: 'expected number, got the string "30"' },
        { code: "empty-row", path: "lineItems[1]", message: "every field of this row is absent" },
        { code: "unknown-key", path: "extra", message: "the schema has no such key" },
        { code: "assertion", path: "", message: "sum(lineItems[].amount) = totals.net: lineItems[].amount sums to 10, not 30" },
      ],
    });
  });

  it("keeps null distinct from absent under strict nulls", () => {
    const Nullable = z.object({ note: z.string().nullable(), count: z.number() });
    const spec = defineEval(Nullable, { strings: exact(), nulls: "strict" });
    expect(spec.validate({ note: null, count: null })).toEqual({ ok: false, issues: [{ code: "wrong-type", path: "count", message: "null is not allowed here" }] });
    expect(spec.score({ note: null, count: 1 }, { count: 1 }).fields.map((field) => [field.path, field.status])).toEqual([
      ["note", "omission"],
      ["count", "match"],
    ]);
  });
});

describe("hungarian rule validation", () => {
  it("rejects keys and weights that name no field of the row", () => {
    expect(problemsOf(() => defineEval(Invoice, {
      ...invoiceRules,
      arrays: { lineItems: hungarian({ key: ["code"], weights: { price: 2 } }) },
    }))).toEqual([
      ["invalid-rule", "lineItems"],
      ["invalid-rule", "lineItems"],
    ]);
  });
});
