/**
 * The typed failure contract.
 *
 * Every error carries a literal `code`, so `switch (err.code)` over
 * {@link DoctureError} is exhaustive and a consumer can tell "nothing was wired
 * that could read this" from "everything ran and everything failed" — which want
 * different fixes.
 */

import type { DocumentFact, DocumentFeatures } from "../domain/document.js";
import type { DoctureErrorCode } from "../domain/error-codes.js";
import type { Attempt, Usage, ValidationIssue } from "../domain/result.js";

export type { DoctureErrorCode } from "../domain/error-codes.js";

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

  /** The next thing to try. Every code has one, and each names a concrete action. */
  get hint(): string {
    return HINTS[this.code];
  }

  /**
   * Every structured field this error carries, JSON-safe: nested errors become
   * `{ code?, name, message }`, so a log line or an agent sees the same diagnosis as
   * the in-process error.
   */
  toJSON(): DoctureErrorJson {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) {
      const safe = jsonSafe(value, new WeakSet());
      if (safe !== undefined) fields[key] = safe;
    }
    const cause = jsonSafe(this.cause, new WeakSet());
    return {
      ...fields,
      code: this.code,
      name: this.name,
      message: this.message,
      hint: this.hint,
      ...(cause === undefined ? {} : { cause }),
    };
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

/** What {@link DoctureError.toJSON} returns: the code, message and hint, plus the error's own diagnostic fields. */
export interface DoctureErrorJson {
  readonly code: DoctureErrorCode;
  readonly name: string;
  readonly message: string;
  readonly hint: string;
  readonly cause?: unknown;
  readonly [field: string]: unknown;
}

function jsonSafe(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      const code: unknown = Reflect.get(value, "code");
      return { ...(typeof code === "string" ? { code } : {}), name: value.name, message: value.message };
    }
    if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen) ?? null);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const safe = jsonSafe(item, seen);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

interface CoreErrorByCode {
  NO_ELIGIBLE_LOADER: NoEligibleLoaderError;
  LOAD_FAILED: LoadFailedError;
  NO_CONVERTIBLE_CONTENT: NoConvertibleContentError;
  NO_ELIGIBLE_STRATEGY: NoEligibleStrategyError;
  EXTRACTION_FAILED: ExtractionFailedError;
  PAGE_OUT_OF_RANGE: PageSelectionError;
  MODEL_OUTPUT_FAILED: ModelOutputError;
  CONTRACT_VIOLATION: ContractViolationError;
  UNSUPPORTED_SOURCE: UnsupportedSourceError;
  TIMEOUT: TimeoutError;
  DUPLICATE_COMPONENT: DuplicateComponentError;
  SPLIT_FAILED: SplitFailedError;
  UNCLASSIFIED_GROUP: UnclassifiedGroupError;
  MISSING_ENGINE: MissingEngineError;
  MISSING_COMPONENT: MissingComponentError;
  DISPOSED: DisposedError;
  INVALID_OPTION: InvalidOptionError;
}

/** The error type `isDoctureError(value, code)` narrows to. */
export type DoctureErrorOf<C extends DoctureErrorCode> = C extends keyof CoreErrorByCode
  ? CoreErrorByCode[C]
  : DoctureError & { readonly code: C };

/**
 * True for an error carrying docture's installed-copy identity. With a `code`, also
 * narrows to that code's class, so its diagnostic fields are reachable without a cast:
 *
 * ```ts
 * if (isDoctureError(outcome.error, "TIMEOUT")) outcome.error.stage;
 * ```
 *
 * A core code matches only an instance of its core class, from any installed copy.
 * An error that merely copies a core code, such as a wrapper reporting its cause's
 * code, does not match; `errorCodeOf` still returns its code.
 */
export function isDoctureError(value: unknown): value is DoctureError;
export function isDoctureError<const C extends DoctureErrorCode>(value: unknown, code: C): value is DoctureErrorOf<C>;
export function isDoctureError(value: unknown, code?: DoctureErrorCode): boolean {
  if (!(value instanceof DoctureError)) return false;
  if (code === undefined) return true;
  return Object.hasOwn(CORE_ERROR_CLASSES, code)
    ? value instanceof CORE_ERROR_CLASSES[code as keyof CoreErrorByCode]
    : value.code === code;
}

/** Required wiring or call state was not supplied by the caller. */
export class MissingComponentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "MissingComponentError";
  override readonly code = "MISSING_COMPONENT" as const;
  constructor(message: string) {
    super(message);
  }
}

/** An option is outside the values it accepts. A wiring mistake, not a bad document. */
export class InvalidOptionError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "InvalidOptionError";
  override readonly code = "INVALID_OPTION" as const;
  /**
   * @param option The option as the caller spells it, such as `concurrency` or `budget.max`.
   * @param expected The accepted values, phrased to follow "must be".
   */
  constructor(
    readonly option: string,
    readonly expected: string,
    readonly received: unknown,
  ) {
    super(`${option} must be ${expected}; received ${shown(received)}.`);
  }

  override get hint(): string {
    return `Set ${this.option} to ${this.expected}.`;
  }
}

function shown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || value == null) return String(value);
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : typeof value;
}

/** A component was used after `dispose()` released its loaders and workers. */
export class DisposedError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DisposedError";
  override readonly code = "DISPOSED" as const;
  constructor(readonly component: string) {
    super(`This ${component} was disposed. Create a new ${component} to convert more documents.`);
  }
}

export class PageSelectionError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "PageSelectionError";
  override readonly code = "PAGE_OUT_OF_RANGE" as const;
  /** Set when the selection may only name the first `maxPages` pages of the document. */
  readonly maxPages?: number;
  /** Set when the selection was checked against the pages a loader returned, which can be fewer than the document has. */
  readonly loadedPages?: readonly number[];
  /**
   * @param pageCount The number of pages the selection was checked against: the document's
   * pages, or with `loadedPages`, the pages a loader returned.
   */
  constructor(
    readonly missingPages: readonly number[],
    readonly pageCount: number,
    options: { maxPages?: number; loadedPages?: readonly number[] } = {},
  ) {
    super(pageSelectionMessage(missingPages, pageCount, options));
    if (options.maxPages !== undefined) this.maxPages = options.maxPages;
    if (options.loadedPages !== undefined) this.loadedPages = options.loadedPages;
  }

  override get hint(): string {
    if (this.loadedPages !== undefined) {
      return "Select pages among loadedPages. A loader can return fewer pages than the document has, for example under its own page limit.";
    }
    return this.maxPages === undefined ? super.hint : "Select pages within the first maxPages pages, or raise maxPages.";
  }
}

function pageSelectionMessage(
  missing: readonly number[],
  pageCount: number,
  { maxPages, loadedPages }: { maxPages?: number; loadedPages?: readonly number[] },
): string {
  const context = loadedPages !== undefined
    ? loadedPages.length === 0 ? "No pages were loaded." : `The loaded pages are ${pageRanges(loadedPages)}.`
    : `The document has ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`;
  if (missing.length === 0) return `Page selection is empty. ${context}`;
  const many = missing.length > 1;
  const pages = many ? `Pages ${missing.join(", ")}` : `Page ${missing[0]}`;
  if (loadedPages !== undefined) return `${pages} ${many ? "were" : "was"} not loaded. ${context}`;
  if (maxPages !== undefined) return `${pages} ${many ? "are" : "is"} outside the first ${maxPages} pages that maxPages allows. ${context}`;
  return `${pages} ${many ? "do" : "does"} not exist. ${context}`;
}

function pageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] ?? 0) + 1) end += 1;
    ranges.push(end === start ? `${sorted[start]}` : `${sorted[start]}-${sorted[end]}`);
    start = end + 1;
  }
  return ranges.join(", ");
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
      gaps.length === 0
        ? `No loader is registered, so nothing can read "${mimeType}". Call loadDocumentLoader(...) or pass { loaders }.`
        : `No loader accepts "${mimeType}". ${gaps.map((g) => `${g.name}: ${g.reason}`).join("; ")}. ` +
          `Register a loader for "${mimeType}" with loadDocumentLoader(...).`,
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

/** A loader read the document, but no eligible loader recovered text that can be indexed. */
export class NoConvertibleContentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "NoConvertibleContentError";
  override readonly code = "NO_CONVERTIBLE_CONTENT" as const;
  constructor(readonly features: DocumentFeatures) {
    super(
      `The loader recovered no convertible text ` +
        `(textLength=${features.textLength}, form=${features.form}). ` +
        `For a scan, list an OCR loader after the text-layer loader. ` +
        `To OCR only the empty pages of a mixed document, wrap the text-layer loader with withOcrFallback(primary, ocr).`,
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
    const facts = `(textLayer=${features.hasTextLayer}, geometry=${features.hasGeometry}, renderable=${features.hasRenderablePages})`;
    super(
      gaps.length === 0
        ? `No extraction strategy is registered ${facts}. Call loadLlm(...) or loadStrategy(...) before extracting.`
        : `No extraction strategy is eligible for this document ${facts}. ` +
          gaps.map((g) => `${g.name}: ${g.reason}`).join("; ") + "." + missingFactFixes(gaps),
    );
  }
}

const FACT_FIXES: Readonly<Partial<Record<DocumentFact, string>>> = {
  RENDERABLE_PAGES: "To give strategies page images, wrap the loader with withRasterizer(loader, rasterizer).",
  TEXT_LAYER: "For a scan with no text layer, add an OCR loader or a vision strategy (loadLlm(model, { vision: true }) on a loader wrapped with withRasterizer).",
  GEOMETRY: "Use a loader that reports text positions, such as DocumentLoaderPdfJs or DocumentLoaderMuPdf.",
};

function missingFactFixes(gaps: readonly Ineligibility[]): string {
  const missing = new Set(gaps.flatMap((gap) => gap.missing ?? []));
  return [...missing].flatMap((fact) => FACT_FIXES[fact] ?? []).map((fix) => ` ${fix}`).join("");
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

/**
 * A strategy produced data that does not satisfy the caller's schema, or
 * schema-valid data that a validation rule rejected in `"fail"` mode.
 */
export class ContractViolationError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "ContractViolationError";
  override readonly code = "CONTRACT_VIOLATION" as const;
  /** `"schema"` when the data does not satisfy the schema; `"rule"` when a validation rule rejected it. */
  readonly failedCheck: "schema" | "rule";
  readonly attempts?: readonly Attempt[];
  readonly usage?: Usage;
  constructor(
    readonly strategy: string,
    readonly issues: readonly ValidationIssue[],
    options: { failedCheck?: "schema" | "rule"; attempts?: readonly Attempt[]; usage?: Usage } = {},
  ) {
    const failedCheck = options.failedCheck ?? "schema";
    super(
      `"${strategy}" produced ` +
        (failedCheck === "rule" ? "schema-valid data that failed a validation rule: " : "data that does not satisfy the schema: ") +
        issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ") +
        ".",
    );
    this.failedCheck = failedCheck;
    if (options.attempts !== undefined) this.attempts = options.attempts;
    if (options.usage !== undefined) this.usage = options.usage;
  }

  override get hint(): string {
    return this.failedCheck === "rule" ? RULE_VIOLATION_HINT : super.hint;
  }
}

export class UnsupportedSourceError extends DoctureError {
  protected static override readonly doctureErrorIdentity: string = "UnsupportedSourceError";
  override readonly code = "UNSUPPORTED_SOURCE" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A deadline this library owns elapsed: a stage's `stageTimeoutMs`, or the whole
 * call's `timeoutMs`, whose `stage` is `"call"`.
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

  override get hint(): string {
    return this.stage === CALL_STAGE ? CALL_TIMEOUT_HINT : super.hint;
  }
}

export const CALL_STAGE = "call";

const CALL_TIMEOUT_HINT = "The whole call exceeded its timeoutMs deadline. Raise timeoutMs, or omit it for no call deadline.";

/** Two components registered under the same name. Never a silent shadowing. */
export class DuplicateComponentError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "DuplicateComponentError";
  override readonly code = "DUPLICATE_COMPONENT" as const;
  /** `fix` replaces the generic advice when the caller knows how the duplicate arose. */
  constructor(
    readonly kind: string,
    readonly componentName: string,
    fix = `Give one of them a distinct name.`,
  ) {
    super(`A ${kind} named "${componentName}" is already registered. ${fix}`);
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
 * True for an error shaped like a platform abort: `AbortController.abort()` gives an
 * `AbortError`, `AbortSignal.timeout()` a `TimeoutError`. Our own
 * {@link TimeoutError} is excluded.
 *
 * The shape does not say WHO aborted. A plugin's own `AbortSignal.timeout()` looks the
 * same as a caller's cancel, so a fallback loop asks {@link isCallerAbort} instead.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DoctureError) return false;
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

/**
 * True when `error` is the caller's cancellation: `signal` is aborted and the error is
 * its reason or an abort-shaped error. A caller abort must propagate and suppress
 * fallback; anything else, including a plugin's own timeout, is a failed attempt the
 * next component still gets a turn after.
 */
export function isCallerAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted !== true) return false;
  return error === signal.reason || isAbortError(error);
}

export function errorCodeOf(error: unknown): DoctureErrorCode | undefined {
  return error instanceof DoctureError ? error.code : undefined;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** How a splitter's groups failed to hold every page exactly once. Each list is page numbers, ascending. */
export interface SplitCoverage {
  /** Pages placed in more than one group. */
  readonly overlaps: readonly number[];
  /** Pages placed in no group. */
  readonly missing: readonly number[];
  /** Pages a group names that the bundle does not have. */
  readonly unknown: readonly number[];
}

/** No splitter is wired, the one that is cannot read this document, or its groups do not cover the bundle. */
export class SplitFailedError extends DoctureError {
  protected static override readonly doctureErrorIdentity = "SplitFailedError";
  override readonly code = "SPLIT_FAILED" as const;
  /** Present when the splitter ran and its groups left pages out, repeated them or named unknown ones. */
  readonly coverage?: SplitCoverage;
  constructor(
    readonly reason: string,
    readonly gaps: readonly Ineligibility[] = [],
    coverage?: SplitCoverage,
  ) {
    const detail = gaps.length === 0 ? "" : ` ${gaps.map((g) => `${g.name}: ${g.reason}`).join("; ")}`;
    super(`Splitting failed: ${reason}.${detail}`);
    if (coverage !== undefined) this.coverage = coverage;
  }

  override get hint(): string {
    return this.coverage === undefined
      ? super.hint
      : "Return groups from the splitter that cover every page of the bundle exactly once; coverage lists the overlapping, missing and unknown pages.";
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

const CORE_ERROR_CLASSES: { readonly [C in keyof CoreErrorByCode]: abstract new (...args: never[]) => CoreErrorByCode[C] } = {
  NO_ELIGIBLE_LOADER: NoEligibleLoaderError,
  LOAD_FAILED: LoadFailedError,
  NO_CONVERTIBLE_CONTENT: NoConvertibleContentError,
  NO_ELIGIBLE_STRATEGY: NoEligibleStrategyError,
  EXTRACTION_FAILED: ExtractionFailedError,
  PAGE_OUT_OF_RANGE: PageSelectionError,
  MODEL_OUTPUT_FAILED: ModelOutputError,
  CONTRACT_VIOLATION: ContractViolationError,
  UNSUPPORTED_SOURCE: UnsupportedSourceError,
  TIMEOUT: TimeoutError,
  DUPLICATE_COMPONENT: DuplicateComponentError,
  SPLIT_FAILED: SplitFailedError,
  UNCLASSIFIED_GROUP: UnclassifiedGroupError,
  MISSING_ENGINE: MissingEngineError,
  MISSING_COMPONENT: MissingComponentError,
  DISPOSED: DisposedError,
  INVALID_OPTION: InvalidOptionError,
};

const HINTS: Readonly<Record<DoctureErrorCode, string>> = {
  NO_ELIGIBLE_LOADER:
    "Register a loader that accepts this media type with loadDocumentLoader(...). The message lists why each registered loader declined.",
  LOAD_FAILED:
    "Read each attempt's error. A corrupt, truncated or password-protected file fails every loader: repair or decrypt it, " +
    "or register another loader as a fallback.",
  NO_CONVERTIBLE_CONTENT:
    "For a scan, list an OCR loader after the text-layer loader, or wrap the text-layer loader with withOcrFallback(primary, ocr).",
  NO_ELIGIBLE_STRATEGY:
    "Register a strategy whose requirements this document meets. For a scan, wrap the loader with withRasterizer(loader, rasterizer) " +
    "and call loadLlm(model, { vision: true }), or add an OCR loader.",
  EXTRACTION_FAILED:
    "Read each entry in attempts for the strategy's error, fix that strategy or its model credentials, or register a fallback strategy after it.",
  PAGE_OUT_OF_RANGE: "Select existing 1-based page numbers and at least one page.",
  MODEL_OUTPUT_FAILED: "The model response did not satisfy the schema. Adjust the schema or instructions.",
  CONTRACT_VIOLATION:
    "Loosen the schema at the paths listed in issues, or steer the model with instructions or per-field descriptions.",
  UNSUPPORTED_SOURCE:
    "Pass bytes, a RawDocument, or an http(s) URL. For a file path or file:// URL, import Extractor from docture/node " +
    "or pass { sourceResolver: resolveNodeSource }.",
  TIMEOUT: "A stage hit its stageTimeoutMs deadline. Raise stageTimeoutMs, or omit it for no stage deadline.",
  DUPLICATE_COMPONENT: "Give one of the two components a distinct name, or remove the second registration.",
  SPLIT_FAILED:
    "The bundle could not be cut into documents. An ImageSplitter needs a loader that can " +
    "render pages — compose one with withRasterizer(loader, rasterizer).",
  UNCLASSIFIED_GROUP:
    "Some pages were split off as a kind that is not in your classification list. Add it, " +
    "or pass { onUnclassified: \"skip\" } to drop those pages.",
  MISSING_ENGINE: "Install the engine package named in the message beside docture, or remove the component that needs it.",
  MISSING_COMPONENT: "Supply the component or call the method the message names, then retry.",
  DISPOSED: "Create a new component. A disposed one has released its engines and cannot be reused.",
  INVALID_OPTION: "Pass the option the message names with one of the values it lists.",
  DOCLING_FAILED:
    "Docling Serve returned no conversion. Read reason and status: fix baseUrl or credentials for a configuration or http failure, " +
    "raise the timeout for a timeout or expired task, and check the file for a conversion failure. outcome \"unknown\" means the task may still finish on the server.",
  DOCX_FAILED:
    "Mammoth could not read this file. Check that it is a valid, unencrypted .docx rather than a legacy .doc, or register another DOCX loader after it.",
  EMAIL_INVALID:
    "Pass the raw RFC 822 message bytes, such as an .eml file. If the message is valid but large, raise maxInputBytes, maxAttachments or maxDecodedBytes.",
  EVAL_SPEC_INVALID:
    "The eval spec cannot be resolved. Fix every listed path: add a fields rule, an arrays rule or a segment, " +
    "or remove the rule that matches nothing.",
  GROUND_TRUTH_INVALID:
    "The expected values do not satisfy the eval spec. Correct the listed paths in the case's expected file, " +
    "or change the spec if the schema is what changed.",
  EVAL_DATASET_INVALID:
    "The dataset cannot produce its cases. Check the listed document or expected file, sign off drafts, " +
    "or pass only case ids the dataset has.",
  EVAL_RUN_STORE_FAILED:
    "A stored run cannot be read or written. Check the run id and the store directory, " +
    "or rerun the eval if the run was written by another format version.",
  OUT_OF_SCOPE:
    "The processor declined this case. The eval records it as skipped; route it to a processor that handles it.",
  MIGRATION_GUARD_FAILED:
    "The migration changed paths outside its targets or gives a different result when applied twice. " +
    "Fix the migration before writing it.",
  EVAL_RUNS_INCOMPARABLE:
    "The two runs cannot be paired. Pick the experiments to compare explicitly, " +
    "or rerun so each case and epoch appears once per experiment.",
  EVAL_PREFLIGHT_FAILED:
    "An experiment failed its preflight check before any case ran. " +
    "Fix the setup the message names, such as a missing credential, model or engine, then rerun.",
  SYNTHESIS_FAILED:
    "The model could not sample a value that passes its schema, constraints and scenario. " +
    "Fix the listed generator or constraint, or loosen the scenario's expect.",
  TEMPLATE_INVALID:
    "The template's drawing does not match its printed mask. Draw every field the mask prints with page.field, " +
    "mark the others false, or use a font that has the listed glyphs.",
  LABEL_VERIFICATION_FAILED:
    "A labeled value is not where its box says on the rendered page. Fix the template's coordinates or widths " +
    "so each field fits on the page.",
};

const RULE_VIOLATION_HINT =
  "The data satisfies the schema but failed a validation rule in fail mode. Check the rule's issues against the document, " +
  'or set onRuleFailure: "report" to keep the data with its issues.';
