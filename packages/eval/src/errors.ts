import { DoctureError } from "docture";

/** Why a spec could not be resolved. Every problem names the schema path or rule it concerns. */
export type SpecProblemCode =
  | "unresolved-field"
  | "unresolved-array"
  | "unalignable-array"
  | "open-object"
  | "unmatched-rule"
  | "ambiguous-rule"
  | "invalid-rule"
  | "invalid-annotation"
  | "unsegmented-field"
  | "overlapping-segments"
  | "unknown-path"
  | "unsupported-schema"
  | "duplicate-metric";

/** One reason a spec failed to resolve. */
export interface SpecProblem {
  readonly code: SpecProblemCode;
  /** Schema pattern or rule key, such as `lineItems[].amount` or `totals.*`. */
  readonly path: string;
  readonly message: string;
}

/** Why a ground-truth value was rejected by `spec.validate`. */
export type GroundTruthIssueCode = "unknown-key" | "wrong-type" | "invalid-value" | "empty-row" | "assertion";

/** One reason ground truth failed strict validation. */
export interface GroundTruthIssue {
  readonly code: GroundTruthIssueCode;
  /** Concrete path, such as `lineItems[2].amount`. The root is `""`. */
  readonly path: string;
  readonly message: string;
}

function listed(items: readonly { readonly path: string; readonly message: string }[]): string {
  return items.map((item) => `\n  - ${item.path === "" ? "(root)" : item.path}: ${item.message}`).join("");
}

/** A spec, metric set or rule set that cannot be resolved. Carries every problem found, not just the first. */
export class EvalSpecError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "EvalSpecError";
  override readonly code = "EVAL_SPEC_INVALID" as const;
  constructor(readonly problems: readonly SpecProblem[]) {
    super(`The eval spec has ${problems.length} problem${problems.length === 1 ? "" : "s"}:${listed(problems)}`);
  }
}

/** The issues of one case whose ground truth failed validation. */
export interface InvalidCaseTruth {
  readonly caseId: string;
  readonly issues: readonly GroundTruthIssue[];
}

function truthMessage(cases: readonly InvalidCaseTruth[]): string {
  const [only] = cases;
  if (cases.length === 1 && only !== undefined) return `Ground truth for case "${only.caseId}" is invalid:${listed(only.issues)}`;
  const issues = cases.flatMap(({ caseId, issues }) =>
    issues.map((issue) => ({ path: issue.path === "" ? caseId : `${caseId}.${issue.path}`, message: issue.message })),
  );
  return `Ground truth for ${cases.length} cases is invalid:${listed(issues)}`;
}

/** Ground truth that does not satisfy its spec. Names every failing case with its own issues. */
export class GroundTruthError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "GroundTruthError";
  override readonly code = "GROUND_TRUTH_INVALID" as const;
  /** Ids of the failing cases, in dataset order. */
  readonly caseIds: readonly string[];
  constructor(readonly cases: readonly InvalidCaseTruth[]) {
    super(truthMessage(cases));
    this.caseIds = cases.map((item) => item.caseId);
  }
}

/** A dataset that cannot produce its cases: a missing document, a missing or draft expected file, or an unknown case id. */
export class DatasetError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DatasetError";
  override readonly code = "EVAL_DATASET_INVALID" as const;
  constructor(
    message: string,
    readonly caseId?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Why a run store operation failed. */
export type RunStoreFailure = "not-found" | "format" | "version" | "conflict" | "io";

/** A stored run or result that cannot be read or written, including a result in an unknown format or version. */
export class RunStoreError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "RunStoreError";
  override readonly code = "EVAL_RUN_STORE_FAILED" as const;
  constructor(
    message: string,
    readonly reason: RunStoreFailure,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Thrown by a processor for a case it does not handle. The runner records a skip, not a failure. */
export class OutOfScopeError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "OutOfScopeError";
  override readonly code = "OUT_OF_SCOPE" as const;
  constructor(
    readonly reason: string,
    options?: { readonly cause?: unknown },
  ) {
    super(reason, options);
  }
}

/** A ground-truth migration with invalid targets, or one that changed a path outside its targets or is not idempotent. */
export class MigrationGuardError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "MigrationGuardError";
  override readonly code = "MIGRATION_GUARD_FAILED" as const;
  /** The case the migration failed on. Absent when the migration itself is invalid. */
  declare readonly caseId?: string;
  constructor(
    readonly migration: string,
    readonly paths: readonly string[],
    message: string,
    options: { readonly caseId?: string } = {},
  ) {
    super(message);
    if (options.caseId !== undefined) this.caseId = options.caseId;
  }
}

/** An experiment's `preflight` check failed, so no case ran. The original failure is the `cause`. */
export class PreflightError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "PreflightError";
  override readonly code = "EVAL_PREFLIGHT_FAILED" as const;
  constructor(
    readonly experiment: string,
    cause: unknown,
  ) {
    super(`Preflight of experiment ${experiment} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Two eval results that cannot be paired for comparison: no shared or an unknown experiment, or a case and epoch recorded twice. Carries every problem found. */
export class IncomparableRunsError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "IncomparableRunsError";
  override readonly code = "EVAL_RUNS_INCOMPARABLE" as const;
  constructor(readonly problems: readonly string[]) {
    super(`The runs cannot be compared:${problems.map((problem) => `\n  - ${problem}`).join("")}`);
  }
}

/** A priced failure with the original error preserved as its cause. */
export class PricedExtractionFailure extends DoctureError {
  protected static override readonly doctureErrorIdentity = "EvalPricedExtractionFailure";
  readonly code: DoctureError["code"];
  readonly usage: Readonly<Record<string, unknown>>;

  constructor(cause: object, usage: Readonly<Record<string, unknown>>) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : "Error";
    this.code = cause instanceof DoctureError ? cause.code : "EXTRACTION_FAILED";
    this.usage = usage;
  }
}
