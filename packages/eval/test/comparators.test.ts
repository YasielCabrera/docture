import { describe, expect, it } from "vitest";
import { boxIoU, date, exact, identifier, number, oneOf, setOf, text, type Comparator } from "../src/index.js";

const ctx = { path: "field", pattern: "field" };

function outcome(comparator: Comparator, expected: unknown, actual: unknown) {
  const result = comparator.compare(expected, actual, ctx);
  if (result instanceof Promise) throw new Error("expected a synchronous comparator");
  return { match: result.match, similarity: Math.round(result.similarity * 1000) / 1000, hint: result.hint?.kind ?? null, detail: result.hint?.detail ?? null, note: result.note ?? null };
}

const row = (match: boolean, similarity: number, hint: string | null = null, detail: string | null = null, note: string | null = null) => ({ match, similarity, hint, detail, note });

describe("comparators", () => {
  it.each([
    ["equal strings", exact(), "Acme", "Acme", row(true, 1)],
    ["case difference", exact(), "Acme", "ACME", row(false, 0.9, "case-or-spacing")],
    ["case ignored when asked", exact({ normalize: "case" }), "Acme", "ACME", row(true, 1)],
    ["number against numeric text", exact(), 1, "1", row(false, 0)],
    ["equal objects in any key order", exact(), { a: 1, b: 2 }, { b: 2, a: 1 }, row(true, 1)],
  ])("exact: %s", (_name, comparator, expected, actual, want) => {
    expect(outcome(comparator, expected, actual)).toEqual(want);
  });

  it.each([
    ["within the absolute tolerance", number({ abs: 0.01 }), 10, 10.004, row(true, 1)],
    ["numeric text", number({ abs: 0.01 }), 10, "10.00", row(true, 1)],
    ["cents read as units", number({ abs: 0.01 }), 12.34, 1234, row(false, 0.01, "minor-unit", "actual is 100x expected")],
    ["flipped sign", number({ abs: 0.01 }), 12.5, -12.5, row(false, 0, "sign")],
    ["swapped adjacent digits", number(), 1234.56, 1243.56, row(false, 0.993, "digit-transposition")],
    ["wrong order of magnitude", number(), 50, 50_000, row(false, 0.001, "scale", "actual is 10^3 times expected")],
    ["within the relative tolerance", number({ rel: 0.01 }), 200, 201.5, row(true, 1)],
    ["outside the relative tolerance", number({ rel: 0.01 }), 200, 203, row(false, 0.985)],
    ["text that is not a number", number(), 10, "ten", row(false, 0, null, null, "not a number")],
    ["numeric text that overflows to infinity", number({ abs: 0.01 }), 10, "1e999", row(false, 0, null, null, "not a number")],
    ["large values differing by more than the absolute tolerance", number({ abs: 0 }), 1e12, 1e12 + 100, row(false, 1)],
    ["a floating-point rounding difference", number({ abs: 0 }), 0.3, 0.1 + 0.2, row(true, 1)],
  ])("number: %s", (_name, comparator, expected, actual, want) => {
    expect(outcome(comparator, expected, actual)).toEqual(want);
  });

  it.each([
    ["ISO date against an ISO date-time", date(), "2024-03-05", "2024-03-05T10:00:00Z", row(true, 1)],
    ["ISO date against a month name", date(), "2024-03-05", "March 5, 2024", row(true, 1)],
    ["day-first layout not configured", date(), "2024-03-05", "05/03/2024", row(false, 0.9, "date-format", "actual uses DD/MM/YYYY")],
    ["day-first layout configured", date({ formats: ["DD/MM/YYYY"] }), "2024-03-05", "05/03/2024", row(true, 1)],
    ["day and month swapped", date(), "2024-03-05", "2024-05-03", row(false, 0.333, "date-format", "day and month swapped")],
    ["same month at month granularity", date({ granularity: "month" }), "2024-03-05", "2024-03-28", row(true, 1)],
    ["same instant in another offset", date({ granularity: "instant" }), "2024-03-05T10:00:00Z", "2024-03-05T11:00:00+01:00", row(true, 1)],
    ["unparseable actual", date(), "2024-03-05", "soon", row(false, 0, null, null, "not a date")],
  ])("date: %s", (_name, comparator, expected, actual, want) => {
    expect(outcome(comparator, expected, actual)).toEqual(want);
  });

  it.each([
    ["spacing and case", identifier(), "DE89 3704 0044 0532 0130 00", "de89370400440532013000", row(true, 1)],
    ["swapped digits", identifier(), "AB-123", "AB-132", row(false, 0.6, "digit-transposition")],
    ["cut short", identifier(), "REF123456", "REF123", row(false, 0.667, "truncation")],
  ])("identifier: %s", (_name, comparator, expected, actual, want) => {
    expect(outcome(comparator, expected, actual)).toEqual(want);
  });

  it.each([
    ["spacing and case", text({ minSimilarity: 0.9 }), "Acme Corporation", "acme  corporation", row(true, 1)],
    ["one OCR slip in a long name", text({ minSimilarity: 0.9 }), "Northwind Industrial GmbH", "Northwind lndustrial GmbH", row(true, 0.96)],
    ["a changed digit", text({ minSimilarity: 0.5 }), "12 Main St", "13 Main St", row(false, 0.9, null, null, "digits differ")],
    ["a changed digit with digits ignored", text({ minSimilarity: 0.5, digits: "ignore" }), "12 Main St", "13 Main St", row(true, 0.9)],
    ["cut short", text({ minSimilarity: 0.9 }), "Acme Corporation", "Acme Corp", row(false, 0.563, "truncation")],
    ["ANLS under its cutoff", text({ minSimilarity: 0.5, metric: "anls" }), "hello", "help", row(true, 0.6)],
    ["ANLS over its cutoff", text({ minSimilarity: 0.5, metric: "anls" }), "hello", "xyz", row(false, 0)],
  ])("text: %s", (_name, comparator, expected, actual, want) => {
    expect(outcome(comparator, expected, actual)).toEqual(want);
  });

  it("oneOf matches equal values and notes values outside the vocabulary", () => {
    const status = oneOf(["paid", "due"]);
    expect([outcome(status, "paid", "paid"), outcome(status, "paid", "due"), outcome(status, "paid", "late")]).toEqual([
      row(true, 1),
      row(false, 0),
      row(false, 0, null, null, "actual is not an allowed value"),
    ]);
    expect([status.check?.("due"), status.check?.("late")]).toEqual([undefined, "expected one of paid, due"]);
  });

  it("setOf pairs elements regardless of order and scores the matched share", () => {
    const colors = setOf(text({ minSimilarity: 0.9 }));
    expect(outcome(colors, ["red", "blue"], ["blue", "red"])).toEqual(row(true, 1));
    expect(outcome(colors, ["red", "blue"], ["blue"])).toEqual(row(false, 0.667, null, null, "1 of 2 expected elements matched"));
  });

  it("boxIoU matches overlapping boxes and never matches across pages", () => {
    const box = boxIoU({ min: 0.5 });
    const base = { x: 0, y: 0, width: 10, height: 10 };
    expect(outcome(box, base, { ...base })).toEqual(row(true, 1));
    expect(outcome(box, base, { x: 5, y: 0, width: 10, height: 10 })).toEqual(row(false, 0.333));
    expect(outcome(box, { ...base, pageNumber: 1 }, { ...base, pageNumber: 2 })).toEqual(row(false, 0, null, null, "different page"));
  });

  it("rejects invalid options when the comparator is built", () => {
    expect(() => number({ abs: -1 })).toThrow("number: abs must be a finite number of at least 0, got -1.");
    expect(() => text({ minSimilarity: 2 })).toThrow("text: minSimilarity must be between 0 and 1, got 2.");
    expect(() => date({ formats: ["DD/MM"] })).toThrow('date: format "DD/MM" needs exactly one year, one month and one day token.');
  });
});
