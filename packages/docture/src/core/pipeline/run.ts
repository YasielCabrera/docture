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
  type ExtractionConflict,
  type ExtractionResult,
  type RuleFailureMode,
  type Usage,
  type ValidationIssue,
  type ValidationRule,
} from "../domain/result.js";
import type { Contract, ContractExample } from "../domain/contract.js";
import type { Classification, Classifier } from "../contracts/classifier.js";
import type { DocumentLoader } from "../contracts/loader.js";
import type {
  ExtractionStrategy,
  RepairInput,
  StrategyContext,
  StrategyOutcome,
} from "../contracts/strategy.js";
import { alignCitations } from "./citations.js";
import { checkedExamples, guidedExamplesOf, serializeExamples, type GuidedExample } from "./examples.js";
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
  repairOutputOf,
} from "./errors.js";
import { documentFeatures, preloadedFeatures } from "./features.js";
import { readDocument } from "./read.js";
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
  /** Default rules. A call's own `rules`, even an empty array, replaces them. */
  readonly rules?: readonly ValidationRule[];
  readonly onRuleFailure?: RuleFailureMode;
  /** Default repair budget per strategy. */
  readonly maxRepairs?: number;
}

export interface RunOptions<T = unknown> {
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
  /**
   * Checks on schema-valid data, typed from the contract. Replaces the extractor's
   * rules; an empty array clears them.
   */
  readonly rules?: readonly ValidationRule<T>[];
  /** Default `"report"`: keep the data and list the issues in `result.validation`. */
  readonly onRuleFailure?: RuleFailureMode;
  /**
   * Times to re-ask a strategy that implements `repair` after its answer failed the
   * schema or a fail-mode rule. Default 1; 0 disables repair. Each repair is a billed
   * call, separate from a model's transport `maxRetries`.
   */
  readonly maxRepairs?: number;
}

const PROCESS_HINTS_KEY = "docture.internal.process-hints.v1";

interface ProcessGuidance {
  readonly hints?: string;
  readonly examples?: readonly GuidedExample[];
}

export function withProcessHints<T>(
  options: RunOptions<T>,
  hints: string | undefined,
  selected?: { readonly owner: string; readonly examples: readonly ContractExample[] | undefined },
): RunOptions<T> {
  const examples = serializeExamples(selected?.examples, selected?.owner ?? "");
  return {
    ...snapshotRunOptions(options),
    [Symbol.for(PROCESS_HINTS_KEY)]: {
      ...(hints === undefined ? {} : { hints }),
      ...(examples === undefined ? {} : { examples }),
    },
  };
}

function processHintsOf<T>(options: RunOptions<T>): ProcessGuidance | undefined {
  const key = Symbol.for(PROCESS_HINTS_KEY);
  if (!(key in options)) return undefined;
  const selection: unknown = options[key];
  if (typeof selection !== "object" || selection === null) return undefined;
  const examples = guidedExamplesOf(selection);
  const withExamples = examples === undefined ? {} : { examples };
  if (!("hints" in selection) || selection.hints === undefined) return withExamples;
  if (typeof selection.hints !== "string") return undefined;
  return { hints: selection.hints, ...withExamples };
}

const CONTRACT_GUIDANCE_KEY = "docture.internal.contract-guidance.v1";

interface ContractGuidance {
  readonly name: string;
  readonly hints?: string;
  readonly examples?: readonly GuidedExample[];
}

export function snapshotRunOptions<T>(options: RunOptions<T>): RunOptions<T> {
  const {
    signal, pages, stageTimeoutMs, only, classifications, classify, logger, rules, onRuleFailure, maxRepairs,
    ...extra
  } = options;
  const fields: { [K in keyof RunOptions<T>]-?: RunOptions<T>[K] | undefined } = {
    signal, pages, stageTimeoutMs, only, classifications, classify, logger, rules, onRuleFailure, maxRepairs,
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
    ...(fields.rules === undefined ? {} : { rules: fields.rules }),
    ...(fields.onRuleFailure === undefined ? {} : { onRuleFailure: fields.onRuleFailure }),
    ...(fields.maxRepairs === undefined ? {} : { maxRepairs: fields.maxRepairs }),
    ...(selected === undefined ? {} : { [Symbol.for(PROCESS_HINTS_KEY)]: selected }),
  };
}

export function withContractGuidance<T>(
  options: RunOptions<T>,
  contract: Pick<Contract, "name" | "hints" | "examples">,
): RunOptions<T> {
  const examples = serializeExamples(contract.examples, `contract "${contract.name}"`);
  return {
    ...snapshotRunOptions(options),
    [Symbol.for(CONTRACT_GUIDANCE_KEY)]: {
      name: contract.name,
      ...(contract.hints === undefined ? {} : { hints: contract.hints }),
      ...(examples === undefined ? {} : { examples }),
    },
  };
}

function contractGuidanceOf<T>(options: RunOptions<T>): ContractGuidance | undefined {
  const key = Symbol.for(CONTRACT_GUIDANCE_KEY);
  if (!(key in options)) return undefined;
  const guidance: unknown = options[key];
  if (typeof guidance !== "object" || guidance === null) return undefined;
  if (!("name" in guidance) || typeof guidance.name !== "string") return undefined;
  const examples = guidedExamplesOf(guidance);
  const withExamples = examples === undefined ? {} : { examples };
  if (!("hints" in guidance) || guidance.hints === undefined) return { name: guidance.name, ...withExamples };
  if (typeof guidance.hints !== "string") return undefined;
  return { name: guidance.name, hints: guidance.hints, ...withExamples };
}

function extractionExamples<T>(options: RunOptions<T>): readonly GuidedExample[] | undefined {
  const selected = processHintsOf(options);
  return selected === undefined ? contractGuidanceOf(options)?.examples : selected.examples;
}

function extractionHints<T>(
  options: RunOptions<T>,
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
  options: RunOptions<T> = {},
): Promise<ExtractionResult<T>> {
  const startedAt = Date.now();
  const logger = options.logger ?? components.logger;
  const signal = options.signal ?? new AbortController().signal;
  const stageTimeoutMs = options.stageTimeoutMs ?? components.stageTimeoutMs;
  const rules = options.rules ?? components.rules ?? [];
  const onRuleFailure = checkedRuleFailureMode(
    options.onRuleFailure !== undefined ? options.onRuleFailure : components.onRuleFailure ?? "report",
  );
  const maxRepairs = checkedMaxRepairs(options.maxRepairs !== undefined ? options.maxRepairs : components.maxRepairs ?? 1);

  signal.throwIfAborted();
  const resolved = await resolveSchema(schema);
  const examples = await checkedExamples(extractionExamples(options), resolved);

  // A pre-loaded source skips the whole load stage — no loader is consulted, no
  // bytes are read. That is what makes `Process` cheap: it parses the bundle once
  // and re-extracts each document it found from the pages it already has.
  const preloaded = isLoadedSource(source) ? source : undefined;

  let document: LoadedDocument;
  let loaderName: string;
  let loadAttempts: readonly Attempt[];
  let featuresFor: (selected: LoadedDocument) => DocumentFeatures;
  let documentLabel: string | undefined;

  if (preloaded !== undefined) {
    document = preloaded.loaded;
    loaderName = preloaded.loaded.loader;
    loadAttempts = [];
    documentLabel = preloaded.fileName;
    featuresFor = (selected) => preloadedFeatures({ ...preloaded, loaded: selected });
  } else {
    const raw = await resolveSource(source, signal);
    const loaded = await readDocument(
      components.loaders, raw, logger, signal, stageTimeoutMs,
      options.pages === undefined ? undefined : { pages: options.pages },
    );
    document = loaded.document;
    loaderName = loaded.loader.name;
    loadAttempts = loaded.attempts;
    documentLabel = raw.fileName;
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
        documentLabel,
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
    let repairsLeft = strategy.repair === undefined ? 0 : maxRepairs;
    let previous: RepairInput | undefined;
    let conflicts: readonly ExtractionConflict[] = [];
    for (;;) {
      signal.throwIfAborted();
      const stage = previous === undefined ? "extract" : "repair";
      const started = Date.now();
      const deadline = withDeadline(`${stage}:${strategy.name}`, stageTimeoutMs, signal);
      let reportedFailureUsage: Partial<Usage> | undefined;
      let outcome: StrategyOutcome | undefined;
      let parsed: { readonly data: T } | undefined;
      let next: RepairInput | undefined;
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
          ...(examples === undefined ? {} : { examples }),
          ...(documentLabel === undefined ? {} : { documentLabel }),
        };
        outcome = previous !== undefined && strategy.repair !== undefined
          ? await strategy.repair(ctx, previous)
          : await strategy.extract(ctx);
        deadline.signal.throwIfAborted();
        if (outcome.conflicts !== undefined && outcome.conflicts.length > 0) conflicts = outcome.conflicts;

        const validation = await resolved.validate(outcome.data);
        deadline.signal.throwIfAborted();
        usage = sumUsage([usage, outcome.usage], usage.wallMs);
        if (validation.ok) {
          parsed = { data: validation.data };
        } else {
          const violation = new ContractViolationError(strategy.name, validation.issues);
          firstViolation ??= violation;
          attempts.push({
            ...failedAttempt(stage, strategy.name, Date.now() - started, violation),
            ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
          });
          next = dataRepair(outcome, validation.issues);
        }
      } catch (error) {
        signal.throwIfAborted();
        const failedUsage = outcome === undefined
          ? reportedFailureUsage ?? (error instanceof ModelOutputError ? error.usage : undefined)
          : outcome.usage;
        const failure = deadline.expired()
          ? new TimeoutError(`${stage}:${strategy.name}`, stageTimeoutMs ?? 0)
          : error;
        if (isAbortError(failure)) throw failure;
        usage = sumUsage([usage, failedUsage], usage.wallMs);
        logger.warn("strategy failed", {
          strategy: strategy.name,
          errorCode: errorCodeOf(failure),
        });
        attempts.push({
          ...failedAttempt(stage, strategy.name, Date.now() - started, failure),
          ...(failedUsage === undefined ? {} : { usage: failedUsage }),
        });
        next = failure instanceof ModelOutputError ? modelOutputRepair(failure) : undefined;
      } finally {
        deadline.release();
      }

      if (parsed !== undefined && outcome !== undefined) {
        const ruleIssues = await checkRules<T>(rules, parsed.data);
        signal.throwIfAborted();
        if (ruleIssues.length === 0 || onRuleFailure === "report") {
          attempts.push({
            stage,
            strategy: strategy.name,
            status: "ok",
            ms: Date.now() - started,
            ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
          });
          const finalClassification = outcome.classification ?? classification;
          return {
            data: parsed.data,
            method: strategy.name,
            loader: loaderName,
            attempts: [...loadAttempts.filter((a) => a.status === "failed"), ...attempts],
            features,
            usage: { ...usage, wallMs: Date.now() - startedAt },
            validation: { valid: ruleIssues.length === 0, issues: ruleIssues },
            ...(finalClassification === undefined ? {} : { classification: finalClassification }),
            ...(conflicts.length === 0 ? {} : { conflicts }),
            ...(outcome.citations === undefined ? {} : alignCitations(parsed.data, outcome.citations, document)),
          };
        }
        const violation = new ContractViolationError(strategy.name, ruleIssues, { failedCheck: "rule" });
        firstViolation ??= violation;
        attempts.push({
          ...failedAttempt(stage, strategy.name, Date.now() - started, violation),
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        });
        next = dataRepair(outcome, ruleIssues);
      }

      if (next === undefined || repairsLeft === 0) break;
      repairsLeft -= 1;
      previous = next;
    }
  }

  // Everything failed. A schema mismatch is the more actionable diagnosis, so it
  // wins over the generic "they all threw".
  const failedUsage = { ...usage, wallMs: Date.now() - startedAt };
  if (firstViolation !== undefined) {
    throw new ContractViolationError(firstViolation.strategy, firstViolation.issues, {
      failedCheck: firstViolation.failedCheck, attempts, usage: failedUsage,
    });
  }
  throw new ExtractionFailedError(attempts, { usage: failedUsage });
}

export function checkedMaxRepairs(maxRepairs: number): number {
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0) {
    throw new RangeError("maxRepairs must be a non-negative integer");
  }
  return maxRepairs;
}

const RULE_FAILURE_MODES: readonly RuleFailureMode[] = ["report", "fail"];

export function checkedRuleFailureMode(mode: RuleFailureMode): RuleFailureMode {
  if (!RULE_FAILURE_MODES.includes(mode)) {
    throw new RangeError(`onRuleFailure must be "report" or "fail"; received ${JSON.stringify(mode) ?? String(mode)}`);
  }
  return mode;
}

function dataRepair(outcome: StrategyOutcome, issues: readonly ValidationIssue[]): RepairInput {
  return {
    kind: "data",
    data: outcome.data,
    issues,
    ...(outcome.citations === undefined ? {} : { citations: outcome.citations }),
  };
}

function modelOutputRepair(error: ModelOutputError): RepairInput | undefined {
  const rawOutput = repairOutputOf(error);
  if (rawOutput === undefined) return undefined;
  const issues = error.issues === undefined || error.issues.length === 0
    ? [{ path: "", message: error.message }]
    : error.issues;
  return { kind: "model-output", rawOutput, issues };
}

async function checkRules<T>(rules: readonly ValidationRule<T>[], data: T): Promise<readonly ValidationIssue[]> {
  const results: unknown[] = await Promise.all(rules.map(async (rule) => rule(data)));
  return results.flatMap((result, index) => ruleIssues(result, index, rules[index]?.name ?? ""));
}

function ruleIssues(result: unknown, index: number, name: string): readonly ValidationIssue[] {
  const invalid = Array.isArray(result) ? result.findIndex((issue) => !isIssue(issue)) : -1;
  if (Array.isArray(result) && invalid < 0) return result as readonly ValidationIssue[];
  const returned = Array.isArray(result)
    ? `an invalid issue at index ${invalid}: ${shown(result[invalid])}`
    : shown(result);
  throw new TypeError(
    `Validation rule ${index}${name === "" ? "" : ` (${name})`} returned ${returned}. ` +
      "Return an array of { path: string, message: string } issues, or [] when the data passes.",
  );
}

function isIssue(value: unknown): value is ValidationIssue {
  return typeof value === "object" && value !== null &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { message?: unknown }).message === "string";
}

function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export { declarationOrder, silentLogger };
