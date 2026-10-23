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
} from "../domain/result.js";
import type { Classification, Classifier } from "../contracts/classifier.js";
import type { DocumentLoader } from "../contracts/loader.js";
import type { ExtractionStrategy, StrategyContext } from "../contracts/strategy.js";
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
  NoEligibleStrategyError,
  PageSelectionError,
  ModelOutputError,
  TimeoutError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./errors.js";
import { documentFeatures, inferForm, preloadedFeatures } from "./features.js";
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

function failedAttempt(name: string, ms: number, error: unknown): Attempt {
  const code = errorCodeOf(error);
  return {
    strategy: name,
    status: "failed",
    ms,
    error: messageOf(error),
    ...(code === undefined ? {} : { errorCode: code }),
  };
}


/**
 * A document narrowed to a page range, page numbers preserved.
 *
 * Numbers are kept as they were in the bundle rather than renumbered from 1, so a
 * report can still say "the invoice was pages 4–6 of the scan".
 */
function selectPages(document: LoadedDocument, pages: readonly number[]): LoadedDocument {
  const known = new Set(document.pages.map((page) => page.pageNumber));
  const missingPages = [...new Set(pages)].filter((number) => !known.has(number));
  if (pages.length === 0 || missingPages.length > 0) {
    throw new PageSelectionError(missingPages, document.pages.length);
  }
  const wanted = new Set(pages);
  const kept = document.pages.filter((page) => wanted.has(page.pageNumber));
  return {
    ...document,
    pages: kept,
    text: kept.map((page) => page.text).join("\f"),
    form: document.form === "mixed" ? inferForm(kept.map((page) => page.text.trim().length)) : document.form,
  };
}

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
    const loaded = await loadDocument(components.loaders, raw, logger, signal, stageTimeoutMs);
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
    try {
      const ctx: StrategyContext = {
        document,
        features,
        schema: resolved,
        signal: deadline.signal,
        logger: logger.child({ strategy: strategy.name }),
        ...(classification === undefined ? {} : { classification }),
      };
      const outcome = await strategy.extract(ctx);
      usage = sumUsage([usage, outcome.usage], usage.wallMs);

      const validation = await resolved.validate(outcome.data);
      if (!validation.ok) {
        const violation = new ContractViolationError(strategy.name, validation.issues);
        firstViolation ??= violation;
        attempts.push({
          ...failedAttempt(strategy.name, Date.now() - started, violation),
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        });
        continue;
      }

      attempts.push({
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
      const failedUsage = error instanceof ModelOutputError ? error.usage : undefined;
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
        ...failedAttempt(strategy.name, Date.now() - started, failure),
        ...(failedUsage === undefined ? {} : { usage: failedUsage }),
      });
    } finally {
      deadline.release();
    }
  }

  // Everything failed. A schema mismatch is the more actionable diagnosis, so it
  // wins over the generic "they all threw".
  throw firstViolation ?? new ExtractionFailedError(attempts);
}

export { declarationOrder, silentLogger };
