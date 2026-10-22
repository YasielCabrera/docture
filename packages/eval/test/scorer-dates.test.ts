import { describe, expect, it } from "vitest";
import { scoreExtraction } from "../src/index.js";

describe("strict calendar dates", () => {
  it.each(["UTC", "Pacific/Kiritimati", "America/Los_Angeles"])(
    "compares written dates independently of TZ=%s",
    (zone) => {
      const previous = process.env.TZ;
      process.env.TZ = zone;
      try {
        for (const actual of [
          "2026-01-15",
          "2026-01-15T00:00:00",
          "2026-01-15T00:00:00Z",
          "2026-01-15T00:30:00+14:00",
          "2026-01-15T23:30:00-12:00",
          "2026-01-15T12:30",
          "2026-01-15T12:30:45.123Z",
          "2026-01-15 10:00:00",
          "2026-01-15T10:00:00+0100",
          "2026-01-15T10:00:00+01",
          "Jan 15 2026",
          "Jan. 15, 2026",
          "15 Jan, 2026",
          "January 15, 2026",
          "15 January 2026",
        ]) {
          const score = scoreExtraction({ date: "2026-01-15" }, { date: actual });

          expect(score.f1, actual).toBe(1);
          expect(score.exactMatch, actual).toBe(true);
        }
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    },
  );

  it.each(["flat", "vat", "candidate", "format", "seat", "update"])(
    "does not parse date-like text under unrelated field names (%s)",
    (key) => {
      const score = scoreExtraction({ [key]: "Room 12" }, { [key]: "Unit 12" });

      expect(score.f1).toBe(0);
      expect(score.exactMatch).toBe(false);
    },
  );

  it("does not parse a VAT label as a date", () => {
    const score = scoreExtraction({ vat: "VAT 5" }, { vat: "Rate 5" });

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
  });

  it.each(["date", "issuedAt", "invoiceDate", "created_at", "dateIssued", "due", "birthdate", "startdate", "enddate", "invoice-date", "dates"])(
    "recognizes date words in the final segment %s",
    (key) => {
      const score = scoreExtraction(
        { records: [{ [key]: "Jan 15 2026" }] },
        { records: [{ [key]: "2026-01-15" }] },
      );

      expect(score.f1).toBe(1);
      expect(score.exactMatch).toBe(true);
    },
  );

  it.each(["candidate", "format", "update", "vat"])(
    "requires a whole date word in %s",
    (key) => {
      const score = scoreExtraction({ [key]: "Jan 15 2026" }, { [key]: "2026-01-15" });

      expect(score.f1).toBe(0);
      expect(score.exactMatch).toBe(false);
    },
  );

  it("does not use date words from parent path segments", () => {
    const score = scoreExtraction(
      { issuedAt: [{ name: "Jan 15 2026" }] },
      { issuedAt: [{ name: "2026-01-15" }] },
    );

    expect(score.f1).toBe(0);
    expect(score.fields).toEqual([
      { path: "issuedAt[0].name", status: "mismatch", expected: "Jan 15 2026", actual: "2026-01-15" },
    ]);
  });

  it.each([
    ["2024-02-29", "2024-02-29T00:00:00Z"],
    ["2000-02-29", "29 February 2000"],
    ["0099-01-15", "15 January 0099"],
  ])("accepts valid calendar date %j against %j", (expected, actual) => {
    const score = scoreExtraction({ date: expected }, { date: actual });

    expect(score.f1).toBe(1);
    expect(score.exactMatch).toBe(true);
  });

  it.each([
    ["2026-02-29", "2026-02-29T00:00:00Z"],
    ["1900-02-29", "1900-02-29T00:00:00Z"],
    ["2026-04-31", "2026-04-31T00:00:00Z"],
    ["2026-00-15", "2026-00-15T00:00:00Z"],
    ["2026-13-15", "2026-13-15T00:00:00Z"],
    ["2026-01-00", "2026-01-00T00:00:00Z"],
    ["February 29 2026", "2026-03-01"],
    ["Apr 31 2026", "2026-05-01"],
    ["01/02/2026", "2026-01-02"],
    ["2026-01-15T24:00:00", "2026-01-16"],
    ["2026-01-15T12:60:00", "2026-01-15"],
    ["2026-01-15T12:30:60", "2026-01-15"],
    ["2026-01-15T12:30:00+24:00", "2026-01-15"],
    ["2026-01-15T12:30:00+00:60", "2026-01-15"],
    ["2026-01-15 trailing text", "2026-01-15"],
  ])("rejects invalid or ambiguous date %j against %j", (expected, actual) => {
    const score = scoreExtraction({ date: expected }, { date: actual });

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
  });

  it("distinguishes written dates even when their instants are equal", () => {
    const score = scoreExtraction(
      { date: "2026-01-15T23:30:00-02:00" },
      { date: "2026-01-16T01:30:00Z" },
    );

    expect(score.f1).toBe(0);
    expect(score.exactMatch).toBe(false);
  });

  it("recognizes an ISO-shaped expected date without a date field name", () => {
    const score = scoreExtraction({ value: "2026-01-15" }, { value: "2026-01-15T00:00:00+14:00" });

    expect(score.f1).toBe(1);
    expect(score.exactMatch).toBe(true);
  });

  it("recognizes a space-separated expected timestamp without a date field name", () => {
    expect(scoreExtraction({ value: "2026-01-15 10:00:00" }, { value: "2026-01-15" }).exactMatch).toBe(true);
  });
});
