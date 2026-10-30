import { LabelVerificationError, SynthesisError, TemplateError } from "@docture/synthetic";
import { describe, expect, it } from "vitest";
import { explain } from "../src/index.js";

describe("synthetic error recovery hints", () => {
  it("points a failed sample at the model's generators and constraints", () => {
    expect(explain(new SynthesisError([{ path: "sumOf(lineItems[].amountCents, subtotalCents)", message: "12 != 13" }]))).toEqual({
      code: "SYNTHESIS_FAILED",
      message: "Synthesis failed:\n  - sumOf(lineItems[].amountCents, subtotalCents): 12 != 13",
      hint: "The model could not sample a value that passes its schema, constraints and scenario. " +
        "Fix the listed generator or constraint in docture.synth.ts, or loosen the scenario's expect.",
    });
  });

  it("points an invalid template at its printed mask and fonts", () => {
    expect(explain(new TemplateError("classic", [{ code: "unprinted-field", path: "dueAt", message: "is printed but never drawn" }])).hint).toBe(
      "The template's drawing does not match its printed mask. Draw every field the mask prints with page.field, " +
        "mark the others false, or use a font that has the listed glyphs.",
    );
  });

  it("points a failed label check at the template's layout, with --no-verify as the escape", () => {
    expect(explain(new LabelVerificationError([{ path: "invoiceNumber", kind: "page-overflow", pageNumber: 1, message: "box leaves the page" }])).hint).toBe(
      "A labeled value is not where its box says on the rendered page. Fix the template's coordinates or widths " +
        "so each field fits on the page, or pass --no-verify to write it anyway.",
    );
  });
});
