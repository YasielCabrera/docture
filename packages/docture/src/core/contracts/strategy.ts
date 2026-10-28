/**
 * The extraction-strategy contract.
 *
 * A strategy turns a loaded document into data. It does NOT validate — the
 * pipeline does that, once, against the caller's schema, so `validation` cannot
 * come to mean two different things depending on which strategy answered.
 */

import type { DocumentFact, DocumentFeatures } from "../domain/document.js";
import type { LineSourceId } from "../domain/conversion.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import type { ClassificationResult, ExtractionConflict, Usage, ValidationIssue } from "../domain/result.js";
import type { ResolvedSchema } from "../pipeline/schema.js";

/** Whether a strategy needs to know what kind of document it is looking at. */
export type ClassificationNeed = "required" | "hint" | "none";

export interface StrategyContext {
  /** Report complete known usage before throwing. The latest report replaces earlier reports. */
  readonly reportFailureUsage?: (usage: Partial<Usage>) => void;
  readonly document: LoadedDocument;
  readonly features: DocumentFeatures;
  readonly schema: ResolvedSchema;
  /** Present when some eligible strategy asked for classification. */
  readonly classification?: ClassificationResult;
  /**
   * Process-selected guidance, then the Contract's defined hints, then the named candidate's.
   * A sole candidate applies only to a bare schema or a Contract with the same name.
   */
  readonly hints?: string;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /** The source's file name, when it has one. Model telemetry may record it. */
  readonly documentLabel?: string;
}

export interface StrategyOutcome {
  /**
   * Unvalidated data. The pipeline validates it against the caller's schema and
   * turns a failure into a typed `ContractViolationError`.
   */
  readonly data: unknown;
  readonly usage?: Partial<Usage>;
  /** A combined classify-and-extract strategy may report what it decided. */
  readonly classification?: ClassificationResult;
  /**
   * Fields its parts disagreed on. Omit or leave empty when there were none; a
   * repair that omits them keeps the conflicts of the outcome it replaced.
   */
  readonly conflicts?: readonly ExtractionConflict[];
  /**
   * The values the model cited, from a strategy that cites. `[]` means it cites but
   * cited nothing. The pipeline marks every other present leaf `uncited`.
   */
  readonly citations?: readonly OutcomeCitation[];
}

/**
 * A cited value as the strategy saw it, before the caller's schema ran. The pipeline
 * keeps `status` only while `value` still equals the final leaf at `path`.
 */
export interface OutcomeCitation {
  /** Object keys and array indexes from the root of `data`. */
  readonly path: readonly (string | number)[];
  readonly status: "verified" | "cited-unverified";
  /** For `verified`, the lines the match spans. Otherwise every cited line that exists. */
  readonly ids: readonly LineSourceId[];
  readonly value: unknown;
}

/**
 * What a repair is asked to fix. `data` is a parsed answer the schema or a fail-mode rule
 * rejected; `model-output` is response text that never parsed into the schema.
 */
export type RepairInput =
  | {
    readonly kind: "data";
    readonly data: unknown;
    readonly issues: readonly ValidationIssue[];
    /** The rejected outcome's citations, when it had any. */
    readonly citations?: readonly OutcomeCitation[];
  }
  | { readonly kind: "model-output"; readonly rawOutput: string; readonly issues: readonly ValidationIssue[] };

export interface ExtractionStrategy {
  /** Stable id. Appears as `result.method` and in every `attempt`. */
  readonly name: string;
  /**
   * Facts about the DOCUMENT that must hold. A strategy whose requirements the
   * document fails is not a candidate and never runs.
   *
   * Note what does NOT belong here: an OCR engine, a model client, a rasterizer.
   * Those are constructor arguments, so they are satisfied by construction rather
   * than discovered as a throw partway through a run.
   */
  readonly requires?: readonly DocumentFact[];
  readonly needsClassification?: ClassificationNeed;
  /**
   * Produce data, or throw. There is no "abstain": an empty result is
   * indistinguishable from a real one for a document that genuinely has no rows,
   * so a strategy that cannot do the job must throw and let the next one try.
   */
  extract(ctx: StrategyContext): Promise<StrategyOutcome>;
  /**
   * Answer again, given the previous answer and what was wrong with it. Optional: the
   * pipeline repairs only strategies that implement it, up to `maxRepairs` times.
   */
  repair?(ctx: StrategyContext, previous: RepairInput): Promise<StrategyOutcome>;
  dispose?(): Promise<void>;
}

/** Identity helper, for symmetry with `defineLoader`. */
export function defineStrategy(strategy: ExtractionStrategy): ExtractionStrategy {
  return strategy;
}
