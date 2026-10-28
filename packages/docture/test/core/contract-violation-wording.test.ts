import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ContractViolationError, createExtractor } from "docture";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";

const Totals = z.object({ total: z.number() });
const bytes = new Uint8Array([1]);
const loader = () => inMemoryLoader(loadedDocument(["Invoice total 60.00 with a complete text layer."]));

async function violation(data: unknown, rules: readonly ((value: { total: number }) => { path: string; message: string }[])[] = []) {
  const failure = await createExtractor({ loaders: [loader()], strategies: [fixedStrategy("primary", data)] })
    .extract(bytes, Totals, { onRuleFailure: "fail", rules })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ContractViolationError);
  return failure as ContractViolationError;
}

describe("contract violation wording", () => {
  it("names the schema when the data does not satisfy it", async () => {
    const error = await violation({ total: "sixty" });
    expect(error.failedCheck).toBe("schema");
    expect(error.message).toBe('"primary" produced data that does not satisfy the schema: total: Invalid input: expected number, received string.');
  });

  it("names the validation rule when schema-valid data fails one in fail mode", async () => {
    const error = await violation({ total: 60 }, [() => [{ path: "total", message: "Sum mismatch" }]]);
    expect(error.failedCheck).toBe("rule");
    expect(error.code).toBe("CONTRACT_VIOLATION");
    expect(error.issues).toEqual([{ path: "total", message: "Sum mismatch" }]);
    expect(error.message).toBe('"primary" produced schema-valid data that failed a validation rule: total: Sum mismatch.');
  });

  it("describes a directly constructed violation as a schema failure", () => {
    const error = new ContractViolationError("custom", [{ path: "", message: "Bad" }]);
    expect([error.failedCheck, error.message]).toEqual(["schema", '"custom" produced data that does not satisfy the schema: (root): Bad.']);
  });
});
