/**
 * Which components could possibly work on this document.
 *
 * Eligibility is separate from ORDER on purpose: a policy decides what runs first,
 * and it only ever sees candidates that are already feasible, so it can never
 * re-derive feasibility and get a different answer.
 */

import { hasFact, type DocumentFact, type DocumentFeatures } from "../domain/document.js";
import type { DocumentLoader } from "../contracts/loader.js";
import { loaderAccepts } from "../contracts/loader.js";
import type { ExtractionStrategy } from "../contracts/strategy.js";
import type { Classifier } from "../contracts/classifier.js";
import type { Ineligibility } from "./errors.js";

export interface Eligible<T> {
  readonly eligible: readonly T[];
  readonly gaps: readonly Ineligibility[];
}

/** Loaders that accept this media type, in declaration order. */
export function eligibleLoaders(
  loaders: readonly DocumentLoader[],
  mimeType: string,
): Eligible<DocumentLoader> {
  const eligible: DocumentLoader[] = [];
  const gaps: Ineligibility[] = [];

  for (const loader of loaders) {
    if (loaderAccepts(loader, mimeType)) eligible.push(loader);
    else {
      gaps.push({
        name: loader.name,
        reason: `accepts ${loader.capabilities.mimeTypes.join(", ")}, not "${mimeType}"`,
      });
    }
  }
  return { eligible, gaps };
}

function missingFacts(
  requires: readonly DocumentFact[] | undefined,
  features: DocumentFeatures,
): DocumentFact[] {
  if (requires === undefined) return [];
  return requires.filter((fact) => !hasFact(features, fact));
}

/** Strategies whose required document facts all hold, in declaration order. */
export function eligibleStrategies(
  strategies: readonly ExtractionStrategy[],
  features: DocumentFeatures,
): Eligible<ExtractionStrategy> {
  const eligible: ExtractionStrategy[] = [];
  const gaps: Ineligibility[] = [];

  for (const strategy of strategies) {
    const missing = missingFacts(strategy.requires, features);
    if (missing.length === 0) eligible.push(strategy);
    else {
      gaps.push({
        name: strategy.name,
        reason: `needs ${missing.join(", ")}`,
        missing,
      });
    }
  }
  return { eligible, gaps };
}

/** Classifiers whose required document facts all hold. */
export function eligibleClassifiers(
  classifiers: readonly Classifier[],
  features: DocumentFeatures,
): Eligible<Classifier> {
  const eligible: Classifier[] = [];
  const gaps: Ineligibility[] = [];

  for (const classifier of classifiers) {
    const missing = missingFacts(classifier.requires, features);
    if (missing.length === 0) eligible.push(classifier);
    else {
      gaps.push({ name: classifier.name, reason: `needs ${missing.join(", ")}`, missing });
    }
  }
  return { eligible, gaps };
}

/**
 * Does any eligible strategy actually want a classification?
 *
 * When none does, classification is skipped entirely — no wasted model call, no
 * wasted OCR pass. It is demand-driven, never automatic.
 */
export function classificationIsWanted(strategies: readonly ExtractionStrategy[]): boolean {
  return strategies.some(
    (s) => s.needsClassification === "required" || s.needsClassification === "hint",
  );
}

/**
 * The default order: **the order you declared them in**, filtered to what is
 * eligible.
 *
 * The most predictable policy there is, and the reason `createExtractor` needs no
 * documentation to explain what runs first. Pass `policy` to override.
 */
export function declarationOrder(
  _features: DocumentFeatures,
  eligible: readonly ExtractionStrategy[],
): readonly ExtractionStrategy[] {
  return eligible;
}

/**
 * Reorder eligible strategies. Sees only eligible candidates, and returning a
 * strategy that was not eligible is ignored rather than honoured.
 */
export type RoutingPolicy = (
  features: DocumentFeatures,
  eligible: readonly ExtractionStrategy[],
  classification: { readonly name: string; readonly confidence: number } | undefined,
) => readonly ExtractionStrategy[];
