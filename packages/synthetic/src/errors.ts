import { DoctureError } from "docture";

/** One reason a sample could not be produced, naming the path or constraint it concerns. */
export interface SynthesisProblem {
  readonly path: string;
  readonly message: string;
}

/** A model could not sample a value that satisfies its schema, constraints and scenario. */
export class SynthesisError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "SynthesisError";
  override readonly code = "SYNTHESIS_FAILED" as const;
  constructor(
    readonly problems: readonly SynthesisProblem[],
    options?: { cause?: unknown },
  ) {
    super(`Synthesis failed:${listed(problems)}`, options);
  }
}

/** Why a template cannot render a value faithfully. */
export type TemplateProblemCode =
  | "undeclared-field"
  | "unprinted-field"
  | "unknown-path"
  | "missing-glyph"
  | "invalid-template";

export interface TemplateProblem {
  readonly code: TemplateProblemCode;
  readonly path: string;
  readonly message: string;
}

/** A template drew something its printed mask does not declare, skipped a declared field, or used a glyph its font lacks. */
export class TemplateError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "TemplateError";
  override readonly code = "TEMPLATE_INVALID" as const;
  constructor(
    readonly template: string,
    readonly problems: readonly TemplateProblem[],
    options?: { cause?: unknown },
  ) {
    super(`Template "${template}" is invalid:${listed(problems)}`, options);
  }
}

/** Why a label could not be confirmed on the rendered page. */
export type LabelFailureKind = "missing" | "outside-box" | "page-overflow";

export interface LabelFailure {
  readonly path: string;
  readonly kind: LabelFailureKind;
  readonly pageNumber: number;
  readonly message: string;
}

/** A rendered document does not show a labeled value inside its labeled box. */
export class LabelVerificationError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "LabelVerificationError";
  override readonly code = "LABEL_VERIFICATION_FAILED" as const;
  constructor(
    readonly failures: readonly LabelFailure[],
    options?: { cause?: unknown },
  ) {
    super(`Label verification failed:${listed(failures.map((failure) => ({ path: failure.path, message: failure.message })))}`, options);
  }
}

function listed(problems: readonly { readonly path: string; readonly message: string }[]): string {
  const shown = problems.slice(0, 10).map((problem) => `\n  - ${problem.path || "(root)"}: ${problem.message}`);
  return shown.join("") + (problems.length > 10 ? `\n  … and ${problems.length - 10} more` : "");
}
