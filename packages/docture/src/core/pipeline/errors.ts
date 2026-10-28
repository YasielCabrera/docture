/**
 * The typed failure contract.
 *
 * Every error carries a literal `code`, so `switch (err.code)` over
 * {@link DoctureError} is exhaustive and a consumer can tell "nothing was wired
 * that could read this" from "everything ran and everything failed" — which want
 * different fixes.
 */

import type { DocumentFact, DocumentFeatures } from "../domain/document.js";
import type { Attempt, Usage, ValidationIssue } from "../domain/result.js";

export type DoctureErrorCode =
  | "NO_ELIGIBLE_LOADER"
  | "LOAD_FAILED"
  | "NO_CONVERTIBLE_CONTENT"
  | "NO_ELIGIBLE_STRATEGY"
  | "EXTRACTION_FAILED"
  | "PAGE_OUT_OF_RANGE"
  | "MODEL_OUTPUT_FAILED"
  | "CONTRACT_VIOLATION"
  | "UNSUPPORTED_SOURCE"
  | "TIMEOUT"
  | "DUPLICATE_COMPONENT"
  | "SPLIT_FAILED"
  | "UNCLASSIFIED_GROUP"
  | "MISSING_ENGINE"
  | "MISSING_COMPONENT";

export abstract class DoctureError extends Error {
  /**
   * Names the class in every installed copy of docture. Only own values count, so a
   * subclass declared outside docture keeps ordinary `instanceof` semantics.
   */
  protected static readonly doctureErrorIdentity: string = "DoctureError";

  abstract readonly code: DoctureErrorCode;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
  }

  toJSON(): { code: DoctureErrorCode; message: string; hint?: string } {
    return { code: this.code, message: this.message };
  }

  /**
   * `instanceof` that also accepts an instance of the same class from another physical
   * copy of docture. pnpm installs one copy per resolved peer set, so an application's
   * config and the CLI can construct errors from different class objects.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
    const wanted = ownIdentity(this);
    if (wanted === undefined || typeof value !== "object" || value === null) return false;
    for (
      let prototype: unknown = Object.getPrototypeOf(value);
      typeof prototype === "object" && prototype !== null;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      if (ownIdentity(Object.getOwnPropertyDescriptor(prototype, "constructor")?.value) === wanted) {
        return true;
      }
    }
    return false;
  }
}

function ownIdentity(constructor: unknown): unknown {
  if (typeof constructor !== "function") return undefined;
  return Object.getOwnPropertyDescriptor(constructor, "doctureErrorIdentity")?.value;
}

/** True for an error carrying docture's installed-copy identity. */
export function isDoctureError(value: unknown): value is DoctureError {
  return value instanceof DoctureError;
}

/** Required wiring or call state was not supplied by the caller. */
export class MissingComponentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "MissingComponentError";
  override readonly code = "MISSING_COMPONENT" as const;
  constructor(message: string) {
    super(message);
  }
}

export class PageSelectionError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "PageSelectionError";
  override readonly code = "PAGE_OUT_OF_RANGE" as const;
  constructor(
    readonly missingPages: readonly number[],
    readonly pageCount: number,
  ) {
    super(missingPages.length === 0
      ? `Page selection is empty. The document has ${pageCount} pages.`
      : `Pages ${missingPages.join(", ")} do not exist. The document has ${pageCount} pages.`);
  }
}

/** A billed model response did not satisfy its requested schema. */
export class ModelOutputError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "ModelOutputError";
  override readonly code = "MODEL_OUTPUT_FAILED" as const;
  readonly usage?: Partial<Usage>;
  readonly rawOutput?: string;
  readonly finishReason?: string;
  readonly issues?: readonly ValidationIssue[];
  constructor(message: string, options: {
    cause?: unknown; usage?: Partial<Usage>; rawOutput?: string;
    finishReason?: string; issues?: readonly ValidationIssue[];
  } = {}) {
    super(message, options);
    if (options.usage !== undefined) this.usage = options.usage;
    if (options.rawOutput !== undefined) this.rawOutput = options.rawOutput.slice(0, 10_000);
    if (options.finishReason !== undefined) this.finishReason = options.finishReason;
    if (options.issues !== undefined) this.issues = options.issues;
  }
}

// A registry symbol, so the pipeline reads text attached by another installed copy.
const REPAIR_OUTPUT = Symbol.for("docture.internal.model-output-text.v1");

export function withRepairOutput<E extends ModelOutputError>(error: E, text: string): E {
  Object.defineProperty(error, REPAIR_OUTPUT, { value: text, enumerable: false });
  return error;
}

export function repairOutputOf(error: ModelOutputError): string | undefined {
  const text: unknown = Object.getOwnPropertyDescriptor(error, REPAIR_OUTPUT)?.value;
  return typeof text === "string" ? text : undefined;
}

/** Why one candidate could not be used. */
export interface Ineligibility {
  readonly name: string;
  readonly reason: string;
  readonly missing?: readonly DocumentFact[];
}

/** No loader accepts this media type. A wiring gap, not a bad document. */
export class NoEligibleLoaderError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "NoEligibleLoaderError";
  override readonly code = "NO_ELIGIBLE_LOADER" as const;
  constructor(
    readonly mimeType: string,
    readonly gaps: readonly Ineligibility[],
  ) {
    super(
      `No loader accepts "${mimeType}". Tried: ${gaps.map((g) => g.name).join(", ") || "(none registered)"}.`,
    );
  }
}

/** Every eligible loader threw. */
export class LoadFailedError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "LoadFailedError";
  override readonly code = "LOAD_FAILED" as const;
  constructor(readonly attempts: readonly Attempt[]) {
    super(
      `Every loader failed: ${attempts.map((a) => `${a.strategy} (${a.error ?? "unknown"})`).join("; ")}.`,
    );
  }
}

/** The selected loader succeeded, but recovered no text that can be indexed. */
export class NoConvertibleContentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "NoConvertibleContentError";
  override readonly code = "NO_CONVERTIBLE_CONTENT" as const;
  constructor(readonly features: DocumentFeatures) {
    super(
      `The loader recovered no convertible text ` +
        `(textLength=${features.textLength}, form=${features.form}). ` +
        `Configure an OCR loader explicitly for scanned documents.`,
    );
  }
}

/**
 * The document loaded, but no strategy can read it — e.g. only a geometry
 * strategy is wired and the PDF is a scan. `features` is what makes this
 * diagnosable rather than mysterious.
 */
export class NoEligibleStrategyError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "NoEligibleStrategyError";
  override readonly code = "NO_ELIGIBLE_STRATEGY" as const;
  constructor(
    readonly features: DocumentFeatures,
    readonly gaps: readonly Ineligibility[],
  ) {
    super(
      `No extraction strategy is eligible for this document ` +
        `(textLayer=${features.hasTextLayer}, geometry=${features.hasGeometry}, ` +
        `renderable=${features.hasRenderablePages}). ` +
        gaps.map((g) => `${g.name}: ${g.reason}`).join("; "),
    );
  }
}

/** Every eligible strategy ran and every one threw. */
export class ExtractionFailedError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "ExtractionFailedError";
  override readonly code = "EXTRACTION_FAILED" as const;
  readonly usage?: Usage;
  constructor(readonly attempts: readonly Attempt[], options: { usage?: Usage } = {}) {
    super(
      `Every extraction strategy failed: ` +
        attempts.map((a) => `${a.strategy} (${a.error ?? "unknown"})`).join("; ") +
        ".",
    );
    if (options.usage !== undefined) this.usage = options.usage;
  }
}

/** A strategy produced data that does not satisfy the caller's schema. */
export class ContractViolationError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "ContractViolationError";
  override readonly code = "CONTRACT_VIOLATION" as const;
  readonly attempts?: readonly Attempt[];
  readonly usage?: Usage;
  constructor(
    readonly strategy: string,
    readonly issues: readonly ValidationIssue[],
    options: { attempts?: readonly Attempt[]; usage?: Usage } = {},
  ) {
    super(
      `"${strategy}" produced data that does not satisfy the schema: ` +
        issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ") +
        ".",
    );
    if (options.attempts !== undefined) this.attempts = options.attempts;
    if (options.usage !== undefined) this.usage = options.usage;
  }
}

export class UnsupportedSourceError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "UnsupportedSourceError";
  override readonly code = "UNSUPPORTED_SOURCE" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A deadline this library owns elapsed.
 *
 * Distinct from a caller's `AbortError`, which propagates untouched and suppresses
 * fallback — the caller asked to stop, so trying the next strategy would be wrong.
 */
export class TimeoutError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "TimeoutError";
  override readonly code = "TIMEOUT" as const;
  constructor(
    readonly stage: string,
    readonly ms: number,
  ) {
    super(`"${stage}" exceeded its ${ms}ms deadline.`);
  }
}

/** Two components registered under the same name. Never a silent shadowing. */
export class DuplicateComponentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DuplicateComponentError";
  override readonly code = "DUPLICATE_COMPONENT" as const;
  constructor(kind: string, name: string) {
    super(`Two ${kind}s are registered as "${name}". Names must be unique.`);
  }
}

/**
 * An integration needs an optional peer package that is not installed. Nothing read
 * the document, so this is an installation gap rather than a bad file.
 */
export class MissingEngineError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "MissingEngineError";
  override readonly code = "MISSING_ENGINE" as const;
  constructor(
    readonly engine: string,
    readonly range: string,
    readonly entry: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${entry} needs the optional peer ${engine}@${range}, which is not installed. ` +
        `Install it beside docture: npm install "${engine}@${range}".`,
      options,
    );
  }
}

/**
 * True for a CALLER-initiated abort, which must never be swallowed and must
 * suppress fallback — the caller asked to stop, so trying the next strategy would
 * be doing work they cancelled.
 *
 * Our own {@link TimeoutError} is deliberately excluded: an internal per-stage
 * deadline is a failure of that strategy, and the next one still deserves a turn.
 * That is the whole reason the two are separate types.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DoctureError) return false;
  if (!(error instanceof Error)) return false;
  // AbortController.abort() → "AbortError"; AbortSignal.timeout() → "TimeoutError".
  return error.name === "AbortError" || error.name === "TimeoutError";
}

export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof DoctureError ? error.code : undefined;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** No splitter is wired, or the one that is cannot read this document. */
export class SplitFailedError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "SplitFailedError";
  override readonly code = "SPLIT_FAILED" as const;
  constructor(
    readonly reason: string,
    readonly gaps: readonly Ineligibility[] = [],
  ) {
    const detail = gaps.length === 0 ? "" : ` ${gaps.map((g) => `${g.name}: ${g.reason}`).join("; ")}`;
    super(`Splitting failed: ${reason}.${detail}`);
  }
}

/**
 * A split produced a group the classification list does not cover.
 *
 * Deliberately an error rather than a silent skip: pages that fell out of a bundle
 * are exactly the ones nobody notices are missing.
 */
export class UnclassifiedGroupError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "UnclassifiedGroupError";
  override readonly code = "UNCLASSIFIED_GROUP" as const;
  constructor(
    readonly pages: readonly number[],
    readonly classification: string,
    readonly candidates: readonly string[],
  ) {
    super(
      `Pages ${pages.join(", ")} were split off as "${classification}", which is not one of ` +
        `the classifications given (${candidates.join(", ") || "none"}). ` +
        `Pass { onUnclassified: "skip" } to drop them instead.`,
    );
  }
}
