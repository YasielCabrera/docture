import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor } from "docture";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { explain } from "../src/index.js";

const extractionFailure = (data: unknown, rules: readonly (() => { path: string; message: string }[])[] = []) =>
  createExtractor({
    loaders: [inMemoryLoader(loadedDocument(["Invoice total 60.00 with a complete text layer."]))],
    strategies: [fixedStrategy("primary", data)],
  }).extract(new Uint8Array([1]), z.object({ total: z.number() }), { onRuleFailure: "fail", rules })
    .catch((error: unknown) => error);

describe("contract violation recovery hints", () => {
  it("points a schema failure at the schema and the instructions", async () => {
    expect(explain(await extractionFailure({ total: "sixty" }))).toEqual({
      code: "CONTRACT_VIOLATION",
      message: '"primary" produced data that does not satisfy the schema: total: Invalid input: expected number, received string.',
      hint: "The data produced does not satisfy your schema. The offending fields are listed above — " +
        "loosen the schema, or add --instructions to steer the model.",
    });
  });

  it("points a business-rule failure at the rule rather than the schema", async () => {
    expect(explain(await extractionFailure({ total: 60 }, [() => [{ path: "total", message: "Sum mismatch" }]]))).toEqual({
      code: "CONTRACT_VIOLATION",
      message: '"primary" produced schema-valid data that failed a validation rule: total: Sum mismatch.',
      hint: "The data satisfies your schema but failed a validation rule in fail mode. The rule's issues are listed above — " +
        'check the document and the rule, or set onRuleFailure: "report" to keep the data with its issues.',
    });
  });
});
