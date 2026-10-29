import { DoctureError } from "docture";
import { describe, expect, it } from "vitest";
import { defineEvalConfig } from "../src/config.js";
import {
  DatasetError,
  GroundTruthError,
  IncomparableRunsError,
  MigrationGuardError,
  OutOfScopeError,
  PreflightError,
  RunStoreError,
  fingerprintOf,
  formatPath,
  inMemoryDataset,
  looseEval,
  patternOf,
  sliceValues,
  toJsonValue,
  type EvalCase,
} from "../src/index.js";

function referenceFnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, "0");
}

describe("fingerprints", () => {
  it("hash canonical JSON with 64-bit FNV-1a, independent of key order", () => {
    expect(fingerprintOf({ b: [1, "é"], a: null })).toBe(referenceFnv1a64('{"a":null,"b":[1,"é"]}'));
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
  });
});

describe("paths", () => {
  it("format concrete paths and their patterns, quoting keys that would read as syntax", () => {
    expect(formatPath(["lineItems", 3, "amount"])).toBe("lineItems[3].amount");
    expect(formatPath(["totals", "net.amount", "a`b"])).toBe("totals.`net.amount`.`a\\`b`");
    expect([patternOf("lineItems[3].amount"), patternOf("rows[0].`a[1]`")]).toEqual(["lineItems[].amount", "rows[].`a[1]`"]);
  });
});

describe("JSON values", () => {
  it("convert the way JSON.stringify would", () => {
    expect(toJsonValue({ at: new Date("2026-01-02T03:04:05Z"), skip: undefined, n: Number.NaN, list: [undefined, 1n] })).toEqual({
      at: "2026-01-02T03:04:05.000Z", n: null, list: [null, "1"],
    });
  });
});

describe("errors", () => {
  it("extend DoctureError with their own identity and codes", () => {
    const errors = [
      new GroundTruthError([{ caseId: "c1", issues: [{ code: "unknown-key", path: "extra", message: "the schema has no such key" }] }]),
      new DatasetError("Case c9 is not in the dataset.", "c9"),
      new RunStoreError("Run r1 does not exist.", "not-found"),
      new OutOfScopeError("scanned input"),
      new MigrationGuardError("rename-iban", ["issuer"], "rename-iban changed issuer, outside its targets.", { caseId: "c1" }),
      new IncomparableRunsError(["experiment fast has case c1 epoch 0 twice"]),
      new PreflightError("llm", new Error("OPENAI_API_KEY is not set")),
    ];
    expect(errors.map((error) => [error instanceof DoctureError, error.name, error.code])).toEqual([
      [true, "GroundTruthError", "GROUND_TRUTH_INVALID"],
      [true, "DatasetError", "EVAL_DATASET_INVALID"],
      [true, "RunStoreError", "EVAL_RUN_STORE_FAILED"],
      [true, "OutOfScopeError", "OUT_OF_SCOPE"],
      [true, "MigrationGuardError", "MIGRATION_GUARD_FAILED"],
      [true, "IncomparableRunsError", "EVAL_RUNS_INCOMPARABLE"],
      [true, "PreflightError", "EVAL_PREFLIGHT_FAILED"],
    ]);
    expect(errors[6]?.message).toBe("Preflight of experiment llm failed: OPENAI_API_KEY is not set");
    expect(errors[0]).toMatchObject({ caseIds: ["c1"] });
    expect(errors[4]).toMatchObject({ caseId: "c1", paths: ["issuer"] });
    expect(errors[5]?.message).toBe("The runs cannot be compared:\n  - experiment fast has case c1 epoch 0 twice");
    expect(errors[0]?.message).toBe('Ground truth for case "c1" is invalid:\n  - extra: the schema has no such key');
    expect([errors[3] instanceof DatasetError, errors[1] instanceof DatasetError]).toEqual([false, true]);
  });

  it("recognize an instance thrown by another installed copy", () => {
    class OtherCopyOutOfScope extends Error {
      static readonly doctureErrorIdentity = "OutOfScopeError";
    }
    expect([new OtherCopyOutOfScope("x") instanceof OutOfScopeError, new OtherCopyOutOfScope("x") instanceof RunStoreError]).toEqual([true, false]);
  });
});

describe("datasets and slices", () => {
  const cases: EvalCase<{ total: number }>[] = [
    { id: "a", documents: [], expected: { total: 1 }, tags: { rendition: "scan" }, params: { degradation: 0.7 } },
    { id: "b", documents: [], expected: { total: 2 }, tags: {} },
  ];

  it("serves in-memory cases and honors an aborted signal", async () => {
    const dataset = inMemoryDataset("memory", cases);
    expect((await dataset.cases()).map((item) => item.id)).toEqual(["a", "b"]);
    await expect(dataset.cases({ signal: AbortSignal.abort() })).rejects.toThrow("This operation was aborted");
  });

  it("evaluate slice paths and functions, leaving absent values out", () => {
    const slices = { rendition: "tags.rendition", severity: (item: EvalCase<{ total: number }>) => ((item.params?.degradation as number | undefined) ?? 0) > 0.6 ? "high" : "low" };
    expect(cases.map((item) => sliceValues(slices, item))).toEqual([{ rendition: "scan", severity: "high" }, { severity: "low" }]);
  });

  it("types a config without changing it", () => {
    const config = { dataset: inMemoryDataset("memory", cases), spec: looseEval(), experiments: { id: "noop", extract: async () => ({ raw: {} }) } };
    expect(defineEvalConfig(config)).toBe(config);
  });
});
