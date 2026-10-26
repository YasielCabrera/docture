import { selectPages } from "./pages.js";
import { failedAttempt } from "./attempt.js";
/**
 * The run loop: load → features → classify (only if wanted) → route → attempt.
 *
 * Every decision this file makes is recorded in `result.attempts`, in order, so a
 * fallback is never silent and "why did the model run?" is answerable from the
 * return value alone.
 */

import type { FlexibleSchema } from "@ai-sdk/provider-utils";
import {
  isLoadedSource,
  type DocumentFeatures,
  type DocumentSource,
} from "../domain/document.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import { silentLogger } from "../domain/logger.js";
import {
  sumUsage,
  type Attempt,
  type ExtractionResult,
  type ValidationOutcome,
  type Usage,
} from "../domain/result.js";
import type { Contract } from "../domain/contract.js";
import type { Classification, Classifier } from "../contracts/classifier.js";
import type { DocumentLoader } from "../contracts/loader.js";
import type { ExtractionStrategy, StrategyContext, StrategyOutcome } from "../contracts/strategy.js";
import { classifyDocument, type ClassifyOptions } from "./classify.js";
import { withDeadline } from "./deadline.js";
import {
  classificationIsWanted,
  declarationOrder,
  eligibleStrategies,
  type RoutingPolicy,
} from "./eligibility.js";
import {
  ContractViolationError,
  ExtractionFailedError,
  ModelOutputError,
  NoEligibleStrategyError,
  TimeoutError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./errors.js";
import { documentFeatures, preloadedFeatures } from "./features.js";
import { loadDocument } from "./read.js";
import { resolveSchema } from "./schema.js";
import { resolveSource } from "./source.js";

export interface PipelineComponents {
  readonly loaders: readonly DocumentLoader[];
  readonly strategies: readonly ExtractionStrategy[];
  readonly classifiers: readonly Classifier[];
  readonly classifications: readonly Classification[];
  readonly policy: RoutingPolicy;
  readonly logger: Logger;
  /** Per-stage deadline. Omit for no deadline. */
  readonly stageTimeoutMs?: number;
  /** How to reconcile disagreeing classifiers. */
  readonly classify?: ClassifyOptions;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Restrict the run to these pages, 1-based. Used when extracting one document
   *  out of a bundle: the pages are already in hand, so re-reading is waste. */
  readonly pages?: readonly number[];
  /** Overrides the extractor's default for this call. */
  readonly stageTimeoutMs?: number;
  /** Restrict to these strategy names, in this order. Useful for an eval sweep. */
  readonly only?: readonly string[];
  /** Candidate document kinds for this call. */
  readonly classifications?: readonly Classification[];
  readonly classify?: ClassifyOptions;
  readonly logger?: Logger;
}

const PROCESS_HINTS_KEY = "docture.internal.process-hints.v1";

export function withProcessHints(options: RunOptions, hints: string | undefined): RunOptions {
  return {
    ...snapshotRunOptions(options),
    [Symbol.for(PROCESS_HINTS_KEY)]: hints === undefined ? {} : { hints },
  };
}

function processHintsOf(options: RunOptions): { readonly hints?: string } | undefined {
  const key = Symbol.for(PROCESS_HINTS_KEY);
  if (!(key in options)) return undefined;
  const selection: unknown = options[key];
  if (typeof selection !== "object" || selection === null) return undefined;
  if (!("hints" in selection) || selection.hints === undefined) return {};
  if (typeof selection.hints !== "string") return undefined;
  return { hints: selection.hints };
}

const CONTRACT_GUIDANCE_KEY = "docture.internal.contract-guidance.v1";

type ContractGuidance = Pick<Contract, "name" | "hints">;

export function snapshotRunOptions(options: RunOptions): RunOptions {
  const { signal, pages, stageTimeoutMs, only, classifications, classify, logger, ...extra } = options;
  const fields: { [K in keyof RunOptions]-?: RunOptions[K] | undefined } = {
    signal, pages, stageTimeoutMs, only, classifications, classify, logger,
  };
  const selected = processHintsOf(options);
  return {
    ...extra,
    ...(fields.signal === undefined ? {} : { signal: fields.signal }),
    ...(fields.pages === undefined ? {} : { pages: fields.pages }),
    ...(fields.stageTimeoutMs === undefined ? {} : { stageTimeoutMs: fields.stageTimeoutMs }),
    ...(fields.only === undefined ? {} : { only: fields.only }),
    ...(fields.classifications === undefined ? {} : { classifications: fields.classifications }),
    ...(fields.classify === undefined ? {} : { classify: fields.classify }),
    ...(fields.logger === undefined ? {} : { logger: fields.logger }),
    ...(selected === undefined ? {} : { [Symbol.for(PROCESS_HINTS_KEY)]: selected }),
  };
}

export function withContractGuidance(options: RunOptions, contract: ContractGuidance): RunOptions {
  return {
    ...snapshotRunOptions(options),
    [Symbol.for(CONTRACT_GUIDANCE_KEY)]: contract.hints === undefined
      ? { name: contract.name }
      : { name: contract.name, hints: contract.hints },
  };
}

function contractGuidanceOf(options: RunOptions): ContractGuidance | undefined {
  const key = Symbol.for(CONTRACT_GUIDANCE_KEY);
  if (!(key in options)) return undefined;
  const guidance: unknown = options[key];
  if (typeof guidance !== "object" || guidance === null) return undefined;
  if (!("name" in guidance) || typeof guidance.name !== "string") return undefined;
  if (!("hints" in guidance) || guidance.hints === undefined) return { name: guidance.name };
  if (typeof guidance.hints !== "string") return undefined;
  return { name: guidance.name, hints: guidance.hints };
}

function extractionHints(
  options: RunOptions,
  candidates: readonly Classification[],
  verdict: string | undefined,
): string | undefined {
  const selected = processHintsOf(options);
  if (selected !== undefined) return selected.hints;
  const contract = contractGuidanceOf(options);
  if (contract?.hints !== undefined) return contract.hints;
  const named = candidates.find((candidate) => candidate.name === verdict);
  if (named !== undefined) return named.hints;
  const sole = candidates.length === 1 ? candidates[0] : undefined;
  return contract === undefined || sole?.name === contract.name ? sole?.hints : undefined;
}




/**
 * A document narrowed to a page range, page numbers preserved.
 *
 * Numbers are kept as they were in the bundle rather than renumbered from 1, so a
 * report can still say "the invoice was pages 4–6 of the scan".
 */

export async function runPipeline<T>(
  components: PipelineComponents,
  source: DocumentSource,
  schema: FlexibleSchema<T>,
  options: RunOptions = {},
): Promise<ExtractionResult<T>> {
  const startedAt = Date.now();
  const logger = options.logger ?? components.logger;
  const signal = options.signal ?? new AbortController().signal;
  const stageTimeoutMs = options.stageTimeoutMs ?? components.stageTimeoutMs;

  signal.throwIfAborted();
  const resolved = await resolveSchema(schema);

  // A pre-loaded source skips the whole load stage — no loader is consulted, no
  // bytes are read. That is what makes `Process` cheap: it parses the bundle once
  // and re-extracts each document it found from the pages it already has.
  const preloaded = isLoadedSource(source) ? source : undefined;

  let document: LoadedDocument;
  let loaderName: string;
  let loadAttempts: readonly Attempt[];
  let featuresFor: (selected: LoadedDocument) => DocumentFeatures;

  if (preloaded !== undefined) {
    document = preloaded.loaded;
    loaderName = preloaded.loaded.loader;
    loadAttempts = [];
    featuresFor = (selected) => preloadedFeatures({ ...preloaded, loaded: selected });
  } else {
    const raw = await resolveSource(source, signal);
    const loaded = await loadDocument(
      components.loaders, raw, logger, signal, stageTimeoutMs,
      options.pages === undefined ? undefined : { pages: options.pages },
    );
    document = loaded.document;
    loaderName = loaded.loader.name;
    loadAttempts = loaded.attempts;
    featuresFor = (selected) => documentFeatures(
      selected,
      loaded.loader,
      raw.mimeType ?? "application/octet-stream",
    );
  }

  // Narrowing to a page range is a projection, not a second load: the same
  // `LoadedPage` objects carry over, so a lazy `page.image()` stays memoized.
  if (options.pages !== undefined) {
    document = selectPages(document, options.pages);
  }
  const features = featuresFor(document);

  const requested =
    options.only === undefined
      ? components.strategies
      : options.only
          .map((name) => components.strategies.find((s) => s.name === name))
          .filter((s): s is ExtractionStrategy => s !== undefined);

  const { eligible, gaps } = eligibleStrategies(requested, features);
  if (eligible.length === 0) throw new NoEligibleStrategyError(features, gaps);

  const candidates = options.classifications ?? components.classifications;
  const classification = classificationIsWanted(eligible)
    ? await classifyDocument(
        components.classifiers,
        candidates,
        document,
        features,
        logger,
        signal,
        stageTimeoutMs,
        options.classify ?? components.classify ?? {},
      )
    : undefined;

  const hints = extractionHints(options, candidates, classification?.name);

  // A strategy that REQUIRES a classification cannot run on an UNKNOWN verdict.
  const routable = eligible.filter(
    (s) =>
      s.needsClassification !== "required" ||
      (classification !== undefined && classification.name !== "UNKNOWN"),
  );
  if (routable.length === 0) {
    throw new NoEligibleStrategyError(
      features,
      eligible.map((s) => ({
        name: s.name,
        reason: "requires a classification, and the document could not be classified",
      })),
    );
  }

  const ordered = components.policy(
    features,
    routable,
    classification === undefined
      ? undefined
      : { name: classification.name, confidence: classification.confidence },
  );
  // A policy that invents or drops candidates does not get to widen eligibility.
  const plan = ordered.filter((s) => routable.includes(s));

  const attempts: Attempt[] = [];
  let usage = sumUsage((classification?.signals ?? []).map((signal) => signal.usage), 0);
  let firstViolation: ContractViolationError | undefined;

  for (const strategy of plan) {
    // Same guard as the load loop: a cancelled run stops here, and the `catch`
    // below never sees it, so fallback cannot resurrect it.
    signal.throwIfAborted();
    const started = Date.now();
    const deadline = withDeadline(`extract:${strategy.name}`, stageTimeoutMs, signal);
    let reportedFailureUsage: Partial<Usage> | undefined;
    let outcome: StrategyOutcome | undefined;
    try {
      const ctx: StrategyContext = {
        document,
        features,
        schema: resolved,
        signal: deadline.signal,
        logger: logger.child({ strategy: strategy.name }),
        reportFailureUsage: (known) => { reportedFailureUsage = known; },
        ...(classification === undefined ? {} : { classification }),
        ...(hints === undefined ? {} : { hints }),
      };
      outcome = await strategy.extract(ctx);
      deadline.signal.throwIfAborted();

      const validation = await resolved.validate(outcome.data);
      deadline.signal.throwIfAborted();
      usage = sumUsage([usage, outcome.usage], usage.wallMs);
      if (!validation.ok) {
        const violation = new ContractViolationError(strategy.name, validation.issues);
        firstViolation ??= violation;
        attempts.push({
          ...failedAttempt("extract", strategy.name, Date.now() - started, violation),
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        });
        continue;
      }

      attempts.push({
        stage: "extract",
        strategy: strategy.name,
        status: "ok",
        ms: Date.now() - started,
        ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
      });

      const finalClassification = outcome.classification ?? classification;
      const outcomeValidation: ValidationOutcome = { valid: true, issues: [] };

      return {
        data: validation.data,
        method: strategy.name,
        loader: loaderName,
        attempts: [...loadAttempts.filter((a) => a.status === "failed"), ...attempts],
        features,
        usage: { ...usage, wallMs: Date.now() - startedAt },
        validation: outcomeValidation,
        ...(finalClassification === undefined ? {} : { classification: finalClassification }),
      };
    } catch (error) {
      signal.throwIfAborted();
      const failedUsage = outcome === undefined
        ? reportedFailureUsage ?? (error instanceof ModelOutputError ? error.usage : undefined)
        : outcome.usage;
      const failure = deadline.expired()
        ? new TimeoutError(`extract:${strategy.name}`, stageTimeoutMs ?? 0)
        : error;
      // The caller cancelled: stop, do not try the next strategy.
      if (isAbortError(failure)) throw failure;
      usage = sumUsage([usage, failedUsage], usage.wallMs);
      logger.warn("strategy failed", {
        strategy: strategy.name,
        errorCode: errorCodeOf(failure),
      });
      attempts.push({
        ...failedAttempt("extract", strategy.name, Date.now() - started, failure),
        ...(failedUsage === undefined ? {} : { usage: failedUsage }),
      });
    } finally {
      deadline.release();
    }
  }

  // Everything failed. A schema mismatch is the more actionable diagnosis, so it
  // wins over the generic "they all threw".
  const failedUsage = { ...usage, wallMs: Date.now() - startedAt };
  if (firstViolation !== undefined) {
    throw new ContractViolationError(firstViolation.strategy, firstViolation.issues, { attempts, usage: failedUsage });
  }
  throw new ExtractionFailedError(attempts, { usage: failedUsage });
}

export { declarationOrder, silentLogger };
