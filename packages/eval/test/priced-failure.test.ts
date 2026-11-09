import { describe, expect, it } from "vitest";
import { ExtractionFailedError, TimeoutError, errorCodeOf, isDoctureError } from "docture";
import { PricedExtractionFailure } from "../src/errors.js";

describe("PricedExtractionFailure", () => {
  it("reports its cause's code without narrowing to the cause's class", () => {
    const cause = new ExtractionFailedError([{ stage: "extract", strategy: "llm", status: "failed", ms: 4, error: "model offline" }]);
    const priced = new PricedExtractionFailure(cause, { costUsd: 0.25 });
    expect(errorCodeOf(priced)).toBe("EXTRACTION_FAILED");
    expect(isDoctureError(priced, "EXTRACTION_FAILED")).toBe(false);
    expect(isDoctureError(priced.cause, "EXTRACTION_FAILED") ? priced.cause.attempts.map((attempt) => attempt.error) : undefined)
      .toEqual(["model offline"]);
  });

  it("does not narrow a priced timeout to TimeoutError", () => {
    const priced = new PricedExtractionFailure(new TimeoutError("call", 30), { costUsd: 0.1 });
    expect(errorCodeOf(priced)).toBe("TIMEOUT");
    expect(isDoctureError(priced, "TIMEOUT")).toBe(false);
    expect(isDoctureError(priced.cause, "TIMEOUT") ? priced.cause.stage : undefined).toBe("call");
  });
});
