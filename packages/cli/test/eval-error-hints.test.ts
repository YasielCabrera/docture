import { DoctureError } from "docture";
import { describe, expect, it } from "vitest";
import { explain } from "@docture/cli";

class EvalSpecError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "EvalSpecError";
  override readonly code = "EVAL_SPEC_INVALID" as const;
}

class RunStoreError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "RunStoreError";
  override readonly code = "EVAL_RUN_STORE_FAILED" as const;
}

class IncomparableRunsError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "IncomparableRunsError";
  override readonly code = "EVAL_RUNS_INCOMPARABLE" as const;
}

class PreflightError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "PreflightError";
  override readonly code = "EVAL_PREFLIGHT_FAILED" as const;
}

describe("eval error recovery hints", () => {
  it("points an unresolved eval spec at its rules, not at the extraction schema", () => {
    expect(explain(new EvalSpecError("The eval spec has 1 problem:\n  - customer: no comparator for this string"))).toEqual({
      code: "EVAL_SPEC_INVALID",
      message: "The eval spec has 1 problem:\n  - customer: no comparator for this string",
      hint: "The eval spec cannot be resolved. Fix every listed path: add a fields rule, an arrays rule or a segment, " +
        "or remove the rule that matches nothing.",
    });
  });

  it("points an unreadable run at the run store, not at a damaged document", () => {
    expect(explain(new RunStoreError("Run r1 does not exist.")).hint).toBe(
      "A stored run cannot be read or written. Check the run id and the store directory, " +
        "or rerun the eval if the run was written by another format version.",
    );
  });

  it("points runs that cannot be paired at experiment selection and duplicate rows, not at the spec", () => {
    expect(explain(new IncomparableRunsError("The runs cannot be compared:\n  - the runs share no experiment")).hint).toBe(
      "The two runs cannot be paired. Pick the experiments to compare explicitly, " +
        "or rerun so each case and epoch appears once per experiment.",
    );
  });

  it("points a failed preflight at the experiment's setup, before any case ran", () => {
    expect(explain(new PreflightError("Preflight of experiment llm failed: OPENAI_API_KEY is not set")).hint).toBe(
      "An experiment failed its preflight check before any case ran. " +
        "Fix the setup the message names, such as a missing credential, model or engine, then rerun.",
    );
  });
});
