import { describe, expect, it } from "vitest";
import { RESULT_SCHEMA } from "../src/result/schema.js";

describe("result-v1.schema.json", () => {
  it("is the schema parseEvalResult validates against", async () => {
    await expect(`${JSON.stringify(RESULT_SCHEMA, null, 2)}\n`).toMatchFileSnapshot("../schemas/result-v1.schema.json");
  });
});
