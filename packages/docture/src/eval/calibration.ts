import { formatFieldPath } from "../core/domain/field-path.js";
import type { FieldCitation } from "../core/domain/result.js";
import { scoreField, type FieldStatus, type ScoreOptions } from "./scorer.js";

export interface CalibrationSample {
  readonly document: string;
  readonly expected: unknown;
  readonly result: { readonly data: unknown; readonly citations?: readonly FieldCitation[] };
}

export interface CalibrationOptions {
  readonly targetPrecision: number;
  readonly minSupport?: number;
  readonly scoreOptions?: ScoreOptions;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface CalibrationPair {
  readonly document: string;
  readonly path: string;
  readonly segments: readonly (string | number)[];
  readonly status: FieldStatus;
  readonly evidence: FieldCitation["status"];
  readonly confidence: number | null;
}

export interface ThresholdCandidate {
  readonly threshold: number;
  readonly accepted: number;
  readonly precision: number;
}

export type FieldThresholdReport = {
  readonly path: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly unknown: number;
  readonly support: number;
  readonly candidates: readonly ThresholdCandidate[];
} & (
  | { readonly status: "supported"; readonly threshold: number; readonly precision: number }
  | { readonly status: "no-supported-threshold"; readonly threshold: null; readonly precision: null }
);

export interface CalibrationReport {
  readonly experimental: true;
  readonly basis: "in-sample empirical OCR evidence";
  readonly targetPrecision: number;
  readonly minSupport: number;
  readonly scoreOptions: ScoreOptions;
  readonly context: Readonly<Record<string, unknown>>;
  readonly pairs: readonly CalibrationPair[];
  readonly fields: readonly FieldThresholdReport[];
}

interface Leaf { readonly segments: readonly (string | number)[]; readonly value: unknown }

function leaves(value: unknown, segments: readonly (string | number)[] = [], output = new Map<string, Leaf>()): Map<string, Leaf> {
  if (Array.isArray(value) && value.length > 0) value.forEach((item, index) => leaves(item, [...segments, index], output));
  else if (typeof value === "object" && value !== null && Object.entries(value).length > 0) {
    for (const [key, item] of Object.entries(value)) leaves(item, [...segments, key], output);
  } else output.set(JSON.stringify(segments), { segments, value });
  return output;
}

function fieldReport(path: string, pairs: readonly CalibrationPair[], options: Required<Pick<CalibrationOptions, "targetPrecision" | "minSupport">>): FieldThresholdReport {
  const known = pairs.filter((pair): pair is CalibrationPair & { readonly confidence: number } => pair.confidence !== null);
  const thresholds = [...new Set(known.map((pair) => pair.confidence))].sort((a, b) => b - a);
  const candidates = thresholds.map((threshold) => {
    const accepted = known.filter((pair) => pair.confidence >= threshold);
    return { threshold, accepted: accepted.length, precision: accepted.filter((pair) => pair.status === "match").length / accepted.length };
  });
  const selected = candidates.filter((candidate) => candidate.accepted >= options.minSupport && candidate.precision >= options.targetPrecision).at(-1);
  return {
    path,
    ...(selected === undefined ? { status: "no-supported-threshold" as const, threshold: null, precision: null } : { status: "supported" as const, threshold: selected.threshold, precision: selected.precision }),
    accepted: selected?.accepted ?? 0, rejected: known.length - (selected?.accepted ?? 0), unknown: pairs.length - known.length,
    support: selected?.accepted ?? 0, candidates,
  };
}

/** Describe supported thresholds on labelled samples; never apply them to an extractor. */
export function calibrateFields(samples: readonly CalibrationSample[], options: CalibrationOptions): CalibrationReport {
  const minSupport = options.minSupport ?? 5;
  if (!Number.isFinite(options.targetPrecision) || options.targetPrecision <= 0 || options.targetPrecision > 1) throw new RangeError("targetPrecision must be in (0, 1].");
  if (!Number.isSafeInteger(minSupport) || minSupport < 1) throw new RangeError("minSupport must be a positive integer.");
  if (options.scoreOptions?.alignArraysBy !== undefined) throw new Error("Calibration does not support alignArraysBy; array evidence must retain its original positions.");
  const pairs: CalibrationPair[] = [];
  for (const sample of samples) {
    const expected = leaves(sample.expected);
    const actual = leaves(sample.result.data);
    const citations = new Map(sample.result.citations?.map((citation) => [citation.path, citation]));
    for (const key of new Set([...expected.keys(), ...actual.keys()])) {
      const left = expected.get(key);
      const right = actual.get(key);
      const segments = left?.segments ?? right?.segments ?? [];
      const path = formatFieldPath(segments);
      const scoringPath = segments.reduce<string>((prefix, segment) => typeof segment === "number" ? `${prefix}[${segment}]` : prefix === "" ? segment : `${prefix}.${segment}`, "");
      const status = scoreField(scoringPath, left?.value, right?.value, options.scoreOptions);
      if (status === undefined) continue;
      const citation = citations.get(path);
      const confidence = citation !== undefined && citation.status !== "uncited" && status !== "omission" ? citation.minOcrConfidence : undefined;
      pairs.push({ document: sample.document, path, segments, status, evidence: citation?.status ?? "uncited", confidence: confidence !== undefined && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null });
    }
  }
  const byField = new Map<string, CalibrationPair[]>();
  for (const pair of pairs) {
    const group = byField.get(pair.path) ?? [];
    group.push(pair);
    byField.set(pair.path, group);
  }
  return {
    experimental: true, basis: "in-sample empirical OCR evidence", targetPrecision: options.targetPrecision, minSupport,
    scoreOptions: options.scoreOptions ?? {}, context: options.context ?? {}, pairs,
    fields: [...byField].map(([path, group]) => fieldReport(path, group, { targetPrecision: options.targetPrecision, minSupport })),
  };
}

export function formatCalibration(report: CalibrationReport): string {
  return [
    "Experimental in-sample empirical OCR thresholds. Validate on held-out documents before operational use.",
    `Target precision ${report.targetPrecision}; minimum support ${report.minSupport}.`,
    `Scoring ${JSON.stringify(report.scoreOptions)}; context ${JSON.stringify(report.context)}.`,
    "| Field | Threshold | Precision | Accepted | Rejected | Unknown | Support |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.fields.map((field) => `| ${field.path.replace(/\|/g, "\\|")} | ${field.threshold ?? "no supported threshold"} | ${field.precision ?? "unknown"} | ${field.accepted} | ${field.rejected} | ${field.unknown} | ${field.support} |`),
  ].join("\n");
}
