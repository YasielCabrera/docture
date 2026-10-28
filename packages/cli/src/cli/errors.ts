/**
 * What the command line can fail with, and what it tells you to do about it.
 *
 * Three exit codes, and the distinction is the whole point:
 *
 *   0  everything worked
 *   1  the tool ran and a DOCUMENT failed — a bad scan, a model that would not
 *      produce the schema, an eval gate that was not met
 *   2  the INVOCATION was wrong — an unknown flag, a missing schema, a model that
 *      cannot be resolved
 *
 * A CI job wants to tell those apart: exit 2 means the pipeline is misconfigured
 * and will fail identically on every rerun; exit 1 means this document did not go
 * through and a different one might.
 */

import type { DoctureError, DoctureErrorCode } from "docture";

export type ExitCode = 0 | 1 | 2;

/** A wrong invocation. Exit 2 — rerunning without changing the command is pointless. */
export class UsageError extends Error {
  readonly exitCode = 2 as const;
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

/** The command ran and could not finish its job. Exit 1. */
export class CliError extends Error {
  readonly exitCode = 1 as const;
  constructor(
    message: string,
    readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = "CliError";
  }
}

/**
 * The next thing to try, per failure code.
 *
 * Core already reports *what* happened precisely; a terminal is the place to say
 * what to do about it. Keyed on the literal `code`, so a new error code is a
 * compile error here rather than a silently unhelpful message.
 */
const HINTS: Readonly<Record<DoctureErrorCode, string>> = {
  PAGE_OUT_OF_RANGE: "Select existing 1-based page numbers and at least one page.",
  MODEL_OUTPUT_FAILED: "The model response did not satisfy the schema. Adjust the schema or instructions.",
  NO_ELIGIBLE_LOADER:
    "No loader accepts this file type. `docture inspect <file>` shows what was tried; " +
    "wire another loader in docture.config.ts.",
  LOAD_FAILED:
    "The file could not be read — it may be corrupt, truncated, or password-protected.",
  NO_CONVERTIBLE_CONTENT:
    "The selected loader found no indexable text. Configure an OCR loader in docture.config.ts for scanned PDFs.",
  NO_ELIGIBLE_STRATEGY:
    "The document loaded but nothing wired can read it. A scan has no text layer: " +
    "add --vision to render the pages and send them to a vision model.",
  EXTRACTION_FAILED: "Every strategy threw. Re-run with --verbose to see each attempt and its error.",
  CONTRACT_VIOLATION:
    "The data produced does not satisfy your schema. The offending fields are listed above — " +
    "loosen the schema, or add --instructions to steer the model.",
  UNSUPPORTED_SOURCE: "Pass an existing, readable file path, a file:// URL, or an http(s) URL.",
  TIMEOUT: "A stage hit its deadline. Raise it with --timeout <ms>, or drop the flag for none.",
  DUPLICATE_COMPONENT:
    "Two components in docture.config.ts share a name. Give one of them a distinct `name`.",
  SPLIT_FAILED:
    "The bundle could not be cut into documents. An ImageSplitter needs a loader that can " +
    "render pages — compose one with withRasterizer(loader, rasterizer).",
  UNCLASSIFIED_GROUP:
    "Some pages were split off as a kind that is not in your classification list. Add it, " +
    "or pass { onUnclassified: \"skip\" } to drop those pages.",
  MISSING_ENGINE:
    "The file was not read. Install the engine named above in the project that runs docture, " +
    "or remove that component from docture.config.ts.",
  MISSING_COMPONENT:
    "Supply the missing component in docture.config.ts before running this command.",
};

const RULE_VIOLATION_HINT =
  "The data satisfies your schema but failed a validation rule in fail mode. The rule's issues are listed above — " +
  'check the document and the rule, or set onRuleFailure: "report" to keep the data with its issues.';

export interface Explained {
  readonly message: string;
  readonly code: string;
  readonly hint?: string;
}

/** Turn any thrown value into something worth printing. */
export function explain(error: unknown): Explained {
  if (error instanceof UsageError || error instanceof CliError) {
    return {
      code: error instanceof UsageError ? "USAGE" : "CLI",
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    };
  }
  if (hasDoctureIdentity(error)) {
    const ruleFailure = error.code === "CONTRACT_VIOLATION" && "failedCheck" in error && error.failedCheck === "rule";
    return { message: error.message, code: error.code, hint: ruleFailure ? RULE_VIOLATION_HINT : HINTS[error.code] };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message };
  }
  return { code: "INTERNAL", message: String(error) };
}

function hasDoctureIdentity(error: unknown): error is DoctureError {
  if (!(error instanceof Error)) return false;
  for (let prototype: unknown = Object.getPrototypeOf(error);
    typeof prototype === "object" && prototype !== null;
    prototype = Object.getPrototypeOf(prototype)) {
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    if (typeof constructor === "function"
      && Object.getOwnPropertyDescriptor(constructor, "doctureErrorIdentity")?.value === "DoctureError") {
      return true;
    }
  }
  return false;
}

/** 130 is the shell's convention for "killed by SIGINT", and CI readers know it. */
export const EXIT_INTERRUPTED = 130;

export function exitCodeOf(error: unknown): ExitCode {
  if (error instanceof UsageError) return 2;
  return 1;
}
