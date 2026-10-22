import { describe, expect, it } from "vitest";
import { scoreExtraction } from "../src/index.js";

describe("digit-aware string similarity", () => {
  it.each([
    ["id", "INV-102345", "INV-102346"],
    ["iban", "DE89370400440532013000", "DE89370400440532013001"],
    ["vatId", "VAT-1023456789", "VAT-1023546789"],
    ["orderNumber", "ORDER-1234567890", "ORDER-123456789"],
    ["reference", "REFERENCE-123456789", "REFERENCE-1234567890"],
    ["name", "Northwind Industrial GmbH", "Northwind Industrial GmbH 1"],
  ])("rejects changed digits in %s", (field, expected, actual) => {
    const score = scoreExtraction({ [field]: expected }, { [field]: actual });

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
    expect(score.counts).toEqual({ match: 0, mismatch: 1, omission: 0, hallucination: 0 });
  });

  it.each([
    ["Main Streat 12", "Main Street 12"],
    ["  MAIN  STREET 12  ", "main street 12"],
  ])("matches %j against %j when the digits agree", (expected, actual) => {
    const score = scoreExtraction({ value: expected }, { value: actual });

    expect(score.f1).toBe(1);
    expect(score.exactMatch).toBe(true);
    expect(score.counts.match).toBe(1);
  });

  it("requires matching digits even with a zero similarity floor", () => {
    const score = scoreExtraction({ id: "INV-102345" }, { id: "INV-102346" }, { stringSimilarity: 0 });

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
  });

  it("still applies the configured similarity floor after the digit check", () => {
    const score = scoreExtraction(
      { address: "Main Streat 12" },
      { address: "Main Street 12" },
      { stringSimilarity: 1 },
    );

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
  });
});
