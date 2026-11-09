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

import type { DoctureErrorCode } from "docture";

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

/** Advice by error code, phrased for whoever reads it. Codes without one keep Docture's own hint. */
export type Hints = Readonly<Partial<Record<DoctureErrorCode, string>>>;

const CLI_HINTS: Hints = {
  NO_ELIGIBLE_LOADER:
    "No loader accepts this file type. `docture inspect <file>` shows what was tried; " +
    "wire another loader in docture.config.ts.",
  NO_CONVERTIBLE_CONTENT:
    "No loader found indexable text. For a scanned PDF, add --ocr tesseract or --ocr paddleocr, " +
    "or configure an OCR loader in docture.config.ts.",
  NO_ELIGIBLE_STRATEGY:
    "The document loaded but nothing wired can read it. A scan has no text layer: " +
    "add --vision to render the pages and send them to a vision model.",
  EXTRACTION_FAILED: "Every strategy threw. Re-run with --verbose to see each attempt and its error.",
  CONTRACT_VIOLATION:
    "The data produced does not satisfy your schema. The offending fields are listed above — " +
    "loosen the schema, or add --instructions to steer the model.",
  UNSUPPORTED_SOURCE: "Pass an existing, readable file path, a file:// URL, or an http(s) URL.",
  TIMEOUT:
    "A deadline elapsed. Raise --timeout <ms> for the whole document, or stageTimeoutMs in docture.config.ts for one stage.",
  DUPLICATE_COMPONENT:
    "Two components in docture.config.ts share a name. Give one of them a distinct `name`.",
  MISSING_ENGINE:
    "The file was not read. Install the engine named above in the project that runs docture, " +
    "or remove that component from docture.config.ts.",
  MISSING_COMPONENT:
    "Supply the missing component in docture.config.ts before running this command.",
  DISPOSED:
    "A converter or loader from docture.config.ts was used after it was disposed. Build a new one per run.",
  SYNTHESIS_FAILED:
    "The model could not sample a value that passes its schema, constraints and scenario. " +
    "Fix the listed generator or constraint in docture.synth.ts, or loosen the scenario's expect.",
  LABEL_VERIFICATION_FAILED:
    "A labeled value is not where its box says on the rendered page. Fix the template's coordinates or widths " +
    "so each field fits on the page, or pass --no-verify to write it anyway.",
};

export const MCP_HINTS: Hints = {
  ...CLI_HINTS,
  NO_ELIGIBLE_LOADER:
    "No loader on this server accepts this file type. The inspect tool shows what was tried.",
  NO_CONVERTIBLE_CONTENT:
    "No loader found indexable text. A scanned PDF needs an OCR loader in the server's docture.config.ts.",
  NO_ELIGIBLE_STRATEGY:
    "The document loaded but nothing configured on this server can read it. A scan has no text layer " +
    "and needs a vision strategy in the server's docture.config.ts.",
  EXTRACTION_FAILED: "Every configured strategy threw. The message names each strategy and its error.",
  CONTRACT_VIOLATION:
    "The data produced does not satisfy the configured schema. The offending fields are listed in the message.",
  TIMEOUT:
    "A deadline in the server's docture.config.ts elapsed. Request fewer pages, or ask the server's operator to raise the deadline.",
};

export const SERVICE_HINTS: Hints = {
  ...MCP_HINTS,
  NO_ELIGIBLE_LOADER: "No loader on this server accepts this file type. The inspect route shows what was tried.",
  TIMEOUT: "A deadline set by this server elapsed. Send fewer pages, or ask the server's operator to raise the deadline.",
};

const RULE_VIOLATION_HINT =
  "The data satisfies your schema but failed a validation rule in fail mode. The rule's issues are listed above — " +
  'check the document and the rule, or set onRuleFailure: "report" to keep the data with its issues.';

export interface Explained {
  readonly message: string;
  readonly code: string;
  readonly hint?: string;
}

/** Turn any thrown value into something worth printing, with `hints` for its reader. */
export function explain(error: unknown, hints: Hints = CLI_HINTS): Explained {
  if (error instanceof UsageError || error instanceof CliError) {
    return {
      code: error instanceof UsageError ? "USAGE" : "CLI",
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    };
  }
  if (hasDoctureIdentity(error)) {
    const ruleFailure = error.code === "CONTRACT_VIOLATION" && error.failedCheck === "rule";
    const hint: string | undefined = ruleFailure ? RULE_VIOLATION_HINT : hints[error.code] ?? error.hint;
    return { message: error.message, code: error.code, ...(hint === undefined ? {} : { hint }) };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message };
  }
  return { code: "INTERNAL", message: String(error) };
}

interface DoctureErrorFromAnyCopy extends Error {
  readonly code: DoctureErrorCode;
  readonly hint?: string;
  readonly failedCheck?: unknown;
}

function hasDoctureIdentity(error: unknown): error is DoctureErrorFromAnyCopy {
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
  if (hasDoctureIdentity(error) && error.code === "INVALID_OPTION") return 2;
  return 1;
}
