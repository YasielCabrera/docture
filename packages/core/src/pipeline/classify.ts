/**
 * Reducing several classifiers' opinions to one verdict.
 *
 * Shared by the run loop and by `extractor.classify()`, so "what kind is this?"
 * cannot answer differently depending on which entry point asked.
 */

import type { DocumentFeatures } from "../domain/document.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import type { ClassificationResult, ClassificationSignal } from "../domain/result.js";
import type { Classification, Classifier } from "../contracts/classifier.js";
import { withDeadline } from "./deadline.js";
import { eligibleClassifiers } from "./eligibility.js";
import { isAbortError, messageOf } from "./errors.js";

/** How to pick a winner when classifiers disagree. */
export type ConsensusStrategy = "consensus" | "higherOrder" | "consensusWithThreshold";

export interface ClassifyOptions {
  readonly strategy?: ConsensusStrategy;
  /** Minimum confidence to accept a verdict. Below it, the answer is UNKNOWN. */
  readonly threshold?: number;
}

type DecidedSignal = ClassificationSignal & { name: string };

/**
 * A verdict is only a verdict if it names a candidate.
 *
 * Without this, a classifier that answers "Bill of Lading" when the candidates are
 * `invoice` and `receipt` produces a `ClassificationResult` whose `name` is neither
 * — which no `switch` downstream handles, and which makes the literal type on
 * `ClassificationResponse` a lie. The signal is still recorded, so the disagreement
 * stays visible; it just does not get to win.
 *
 * Matching is case-insensitive and returns the CANDIDATE's spelling, because a model
 * will answer "Invoice" for a candidate named "invoice" and failing over
 * capitalisation would be absurd. With no candidates at all there is nothing to
 * check against, and the classifier is free-labelling on purpose.
 */
function reconcile(
  signals: readonly DecidedSignal[],
  candidates: readonly Classification[],
): DecidedSignal[] {
  if (candidates.length === 0) return [...signals];
  const byLowerName = new Map(candidates.map((c) => [c.name.toLowerCase(), c.name]));
  return signals.flatMap((signal) => {
    const matched = byLowerName.get(signal.name.toLowerCase());
    return matched === undefined ? [] : [{ ...signal, name: matched }];
  });
}

/** Most-voted name, ties broken by summed confidence. */
function consensus(signals: readonly DecidedSignal[]): DecidedSignal | undefined {
  const tally = new Map<string, { votes: number; confidence: number; best: DecidedSignal }>();
  for (const signal of signals) {
    const entry = tally.get(signal.name);
    if (entry === undefined) {
      tally.set(signal.name, { votes: 1, confidence: signal.confidence, best: signal });
    } else {
      entry.votes += 1;
      entry.confidence += signal.confidence;
      if (signal.confidence > entry.best.confidence) entry.best = signal;
    }
  }
  let winner: { votes: number; confidence: number; best: DecidedSignal } | undefined;
  for (const entry of tally.values()) {
    if (
      winner === undefined ||
      entry.votes > winner.votes ||
      (entry.votes === winner.votes && entry.confidence > winner.confidence)
    ) {
      winner = entry;
    }
  }
  return winner?.best;
}

/** Single most-confident verdict, regardless of how many agree. */
function higherOrder(signals: readonly DecidedSignal[]): DecidedSignal | undefined {
  return signals.reduce<DecidedSignal | undefined>(
    (best, s) => (best === undefined || s.confidence > best.confidence ? s : best),
    undefined,
  );
}

/**
 * Run every eligible classifier, then reduce.
 *
 * Never throws for a classifier's sake: a classifier that breaks its
 * no-throw contract is recorded as an abstention with a note, because failing the
 * document would deny a later classifier — or the UNKNOWN fallback — its turn.
 */
export async function classifyDocument(
  classifiers: readonly Classifier[],
  candidates: readonly Classification[],
  document: LoadedDocument,
  features: DocumentFeatures,
  logger: Logger,
  signal: AbortSignal,
  stageTimeoutMs: number | undefined,
  options: ClassifyOptions = {},
): Promise<ClassificationResult> {
  const { eligible } = eligibleClassifiers(classifiers, features);
  const signals: ClassificationSignal[] = [];

  for (const classifier of eligible) {
    const deadline = withDeadline(`classify:${classifier.name}`, stageTimeoutMs, signal);
    try {
      const verdict = await classifier.classify({
        document,
        features,
        candidates,
        signal: deadline.signal,
        logger: logger.child({ classifier: classifier.name }),
      });
      if (verdict !== null) signals.push(verdict);
    } catch (error) {
      if (isAbortError(error)) throw error;
      signals.push({
        classifier: classifier.name,
        name: null,
        confidence: 0,
        note: `threw: ${messageOf(error)}`,
      });
    } finally {
      deadline.release();
    }
  }

  const decided = reconcile(
    signals.filter((s): s is DecidedSignal => s.name !== null && s.confidence > 0),
    candidates,
  );
  if (decided.length === 0) return { name: "UNKNOWN", confidence: 0, signals };

  const strategy = options.strategy ?? "higherOrder";
  const winner =
    strategy === "consensus" || strategy === "consensusWithThreshold"
      ? consensus(decided)
      : higherOrder(decided);

  if (winner === undefined) return { name: "UNKNOWN", confidence: 0, signals };

  const threshold =
    strategy === "consensusWithThreshold" || strategy === "higherOrder"
      ? (options.threshold ?? 0)
      : 0;
  if (winner.confidence < threshold) return { name: "UNKNOWN", confidence: 0, signals };

  return { name: winner.name, confidence: winner.confidence, signals };
}
