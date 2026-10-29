import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EvalSpecError, byIndex, defineComparator, defineEval, exact, groundingRule, hungarian, isGrounded, looseEval, number, prf, supportsLocation, text, type ScoreExtras } from "../src/index.js";
import { invoice, invoiceSpec } from "./support/invoice.js";

const Pair = z.object({ name: z.string().nullable(), total: z.number().nullable() });
const pairSpec = defineEval(Pair, { strings: text({ minSimilarity: 0.9 }), fields: { total: { compare: number({ abs: 0.01 }), weight: 3, critical: true } } });

describe("case scores", () => {
  it("returns null, not a perfect score, when there is nothing to grade", () => {
    const metrics = (expected: object, actual: object) => {
      const { precision, recall, f1, exact: isExact } = pairSpec.score(expected as never, actual).metrics;
      return { precision, recall, f1, exact: isExact };
    };
    expect(metrics({ name: null, total: null }, {})).toEqual({ precision: null, recall: null, f1: null, exact: true });
    expect(metrics({ name: "Acme", total: 10 }, {})).toEqual({ precision: null, recall: 0, f1: 0, exact: false });
    expect(metrics({ name: null, total: null }, { name: "Acme" })).toEqual({ precision: 0, recall: null, f1: 0, exact: false });
  });

  it("weights fields and fails the critical check on a wrong critical field", () => {
    const score = pairSpec.score({ name: "Acme", total: 10 }, { name: "Acme", total: 12 });
    expect([score.counts, score.weighted]).toEqual([
      { match: 1, mismatch: 1, omission: 0, hallucination: 0 },
      { match: 1, mismatch: 3, omission: 0, hallucination: 0 },
    ]);
    expect([score.metrics.precision, score.metrics.critical]).toEqual([0.25, false]);
    expect(score.fields.map((field) => [field.path, field.weight, field.critical ?? false])).toEqual([["name", 1, false], ["total", 3, true]]);
  });

  it("scores per segment and checks assertions on the output", () => {
    const actual = invoice({ totals: { net: 30, tax: 5.7, total: 35.7 }, lineItems: [{ sku: "A-100", description: "Steel bolts", amount: 10 }, { sku: "B-200", description: "Washers", amount: 25 }] });
    const score = invoiceSpec.score(invoice(), actual);
    expect(Object.fromEntries(Object.entries(score.segments).map(([name, segment]) => [name, segment.f1]))).toEqual({ header: 1, totals: 1, lineItems: 5 / 6 });
    expect(score.assertions).toEqual([{
      id: "sum(lineItems[].amount) = totals.net", status: "fail", message: "lineItems[].amount sums to 35, not 30", expected: 30, actual: 35,
    }]);
  });

  it("attaches confidence and evidence by actual path and grounds matched fields at their expected location", () => {
    const actual = invoice({ lineItems: [invoice().lineItems[1]!, invoice().lineItems[0]!] });
    const score = invoiceSpec.score(invoice(), actual, {
      confidence: { "lineItems[1].amount": 0.97 },
      evidence: [
        { path: "lineItems[1].amount", pageNumber: 1, box: { x: 100, y: 200, width: 40, height: 10 } },
        { path: "issuer", pageNumber: 2 },
      ],
      locations: {
        "lineItems[0].amount": [{ pageNumber: 1, box: { x: 102, y: 200, width: 40, height: 10 } }],
        issuer: [{ pageNumber: 1 }],
      },
    });
    const pick = (path: string) => {
      const field = score.fields.find((item) => item.path === path);
      return [field?.actualPath, field?.confidence, field?.grounded];
    };
    expect([pick("lineItems[0].amount"), pick("issuer"), pick("reference")]).toEqual([
      ["lineItems[1].amount", 0.97, true],
      [undefined, undefined, false],
      [undefined, undefined, null],
    ]);
  });

  it("grounds a field only when page-only evidence meets a page-only label at box level", () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const grounded = (extras: ScoreExtras) => looseEval().score({ a: 1 }, { a: 1 }, extras).fields[0]?.grounded;
    expect([
      grounded({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1 }] }),
      grounded({ locations: { a: [{ pageNumber: 1 }] }, evidence: [{ path: "a", pageNumber: 1, box }] }),
      grounded({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box: { ...box, x: 2 } }] }),
      grounded({ locations: { a: [{ pageNumber: 1, box }] }, evidence: [{ path: "a", pageNumber: 1, box: { ...box, x: 6 } }] }),
    ]).toEqual([false, true, true, false]);
  });

  it("refuses to score an async comparator synchronously and awaits it in scoreAsync", async () => {
    const slow = defineComparator({ id: "slow", async: true, compare: async (expected, actual) => ({ match: expected === actual, similarity: expected === actual ? 1 : 0 }) });
    const spec = defineEval(Pair, { strings: slow, fields: { total: exact() } });
    expect(() => spec.score({ name: "a", total: 1 }, { name: "a", total: 1 })).toThrow("name uses the async comparator slow; call spec.scoreAsync instead.");
    expect((await spec.scoreAsync({ name: "a", total: 1 }, { name: "b", total: 1 })).counts).toEqual({ match: 1, mismatch: 1, omission: 0, hallucination: 0 });
  });

  it("scores a null or empty container under strict nulls and lets absent nulls collapse", () => {
    const Shipping = z.object({ address: z.object({ city: z.string() }).nullable(), parcels: z.array(z.object({ id: z.string() })).nullable() });
    const strict = defineEval(Shipping, { strings: exact(), nulls: "strict", arrays: { parcels: byIndex() } });
    const statuses = (expected: unknown, actual: unknown) => strict.score(expected as never, actual).fields.map((field) => [field.path, field.status]);
    expect(statuses({ address: null, parcels: [] }, {})).toEqual([["address", "omission"], ["parcels", "omission"]]);
    expect(statuses({}, { address: null, parcels: [] })).toEqual([["address", "hallucination"], ["parcels", "hallucination"]]);
    expect(statuses({ address: null, parcels: null }, { address: null, parcels: null })).toEqual([["address", "match"], ["parcels", "match"]]);
    expect(statuses({ address: null, parcels: [] }, { address: { city: "Oslo" }, parcels: null })).toEqual([
      ["address", "mismatch"], ["address.city", "hallucination"], ["parcels", "mismatch"],
    ]);
    expect(statuses({ address: { city: "Oslo" }, parcels: [{ id: "p1" }] }, { address: { city: "Oslo" }, parcels: [{ id: "p1" }] })).toEqual([
      ["address.city", "match"], ["parcels[0].id", "match"],
    ]);
    const absent = defineEval(Shipping, { strings: exact(), arrays: { parcels: byIndex() } });
    expect(absent.score({ address: null, parcels: [] }, {}).fields).toEqual([]);
  });

  it("pairs null rows with null rows under strict nulls", () => {
    const Rows = z.object({ rows: z.array(z.object({ a: z.number() }).nullable()), values: z.array(z.number().nullable()) });
    const spec = defineEval(Rows, { nulls: "strict", arrays: { rows: hungarian(), values: hungarian() } });
    const score = spec.score({ rows: [null, { a: 1 }], values: [null, 2] }, { rows: [{ a: 1 }, null], values: [2, null] });
    expect([score.metrics.f1, score.metrics.exact, score.arrays.map((report) => report.matched)]).toEqual([1, true, [2, 2]]);
  });

  it("computes F1 from counts so a run that predicted nothing scores 0", () => {
    expect(prf({ match: 0, mismatch: 0, omission: 4, hallucination: 0 })).toEqual({ precision: null, recall: 0, f1: 0 });
    expect(prf({ match: 3, mismatch: 1, omission: 1, hallucination: 1 })).toEqual({ precision: 0.6, recall: 0.6, f1: 0.6 });
  });
});

describe("looseEval", () => {
  const loose = looseEval();
  const statuses = (expected: unknown, actual: unknown) => Object.fromEntries(loose.score(expected, actual).fields.map((field) => [field.path, field.status]));

  it("keeps the previous scorer's defaults for numbers, dates and strings", () => {
    expect(statuses(
      { total: 1234.56, issuedAt: "2026-01-15", name: "Northwind Industrial GmbH", street: "12 Main St", paid: true },
      { total: 1234.5599999, issuedAt: "2026-01-15T00:00:00Z", name: "Northwind lndustrial GmbH", street: "13 Main St", paid: false },
    )).toEqual({ total: "match", issuedAt: "match", name: "match", street: "mismatch", paid: "mismatch" });
  });

  it("distinguishes wrong, missing and invented values and pairs arrays by index", () => {
    const score = loose.score(
      { wrong: "expected", missing: "gone", rows: [{ a: 1 }, { a: 2 }] },
      { wrong: "actual", invented: "surprise", rows: [{ a: 1 }] },
    );
    expect(score.fields.map((field) => [field.path, field.status])).toEqual([
      ["wrong", "mismatch"], ["missing", "omission"], ["rows[0].a", "match"], ["rows[1].a", "omission"], ["invented", "hallucination"],
    ]);
    expect(score.arrays.map((report) => [report.path, report.algorithm, report.missing])).toEqual([["rows", "index", 1]]);
  });

  it("sorts arrays by a key before pairing when asked", () => {
    const byId = looseEval({ alignArraysBy: "id" });
    expect(byId.score({ rows: [{ id: "a", v: 1 }, { id: "b", v: 2 }] }, { rows: [{ id: "b", v: 2 }, { id: "a", v: 1 }] }).metrics.exact).toBe(true);
    expect(loose.score({ rows: [{ id: "a", v: 1 }, { id: "b", v: 2 }] }, { rows: [{ id: "b", v: 2 }, { id: "a", v: 1 }] }).metrics.exact).toBe(false);
  });
});

describe("grounding rule", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const shifted = { x: 5, y: 0, width: 10, height: 10 };

  it("supports a location by box overlap at box level and by page at page level", () => {
    expect([
      supportsLocation([{ pageNumber: 1, box: shifted }], [{ pageNumber: 1, box }]),
      supportsLocation([{ pageNumber: 1, box: shifted }], [{ pageNumber: 1, box }], { iou: 1 / 3 }),
      supportsLocation([{ pageNumber: 1 }], [{ pageNumber: 1, box }], { level: "page" }),
      supportsLocation([{ pageNumber: 2, box }], [{ pageNumber: 1, box }], { level: "page" }),
    ]).toEqual([false, true, true, false]);
  });

  it("grounds only matched fields", () => {
    const evidence = [{ pageNumber: 1, box }];
    expect([
      isGrounded({ status: "match", evidence }, [{ pageNumber: 1, box }]),
      isGrounded({ status: "mismatch", evidence }, [{ pageNumber: 1, box }]),
      isGrounded({ status: "match" }, [{ pageNumber: 1, box }]),
    ]).toEqual([true, false, false]);
  });

  it("rejects an IoU outside (0, 1] and an unknown level in one error", () => {
    expect(groundingRule()).toEqual({ iou: 0.5, level: "box" });
    expect(() => groundingRule({ iou: 0, level: "region" as "box" })).toThrow(EvalSpecError);
    expect(() => groundingRule({ iou: 0, level: "region" as "box" })).toThrow(
      "The eval spec has 2 problems:\n  - grounding.iou: IoU must be in (0, 1], got 0\n  - grounding.level: level must be box or page, got region",
    );
    expect(() => isGrounded({ status: "match" }, [], { iou: 1.5 })).toThrow("grounding.iou: IoU must be in (0, 1], got 1.5");
  });
});
