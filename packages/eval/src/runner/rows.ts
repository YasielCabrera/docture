import type { EvalCase } from "../case.js";
import { GroundTruthError, type InvalidCaseTruth } from "../errors.js";
import { toJsonValue } from "../json.js";
import { omittedOf } from "../metrics/builtin.js";
import type { MetricDefinition } from "../metrics/types.js";
import { buildResult } from "../result/build.js";
import type { CaseResult, ErroredCase, RunInfo } from "../result/types.js";
import { sliceValues, type SliceMap } from "../slices.js";
import type { EvalSpec } from "../spec/types.js";
import { caseFingerprint } from "../dataset/index.js";
import type { StoredRaw } from "../store.js";
import type { OutputSignals } from "./output.js";

/** Which experiment, config and epoch produced a row. */
export interface JobKey {
  readonly experiment: string;
  /** Absent only for rows built outside the runner that never recorded one. */
  readonly configHash?: string;
  readonly epoch: number;
}

type RowMetadata = Pick<
  CaseResult,
  "caseId" | "caseFingerprint" | "experiment" | "configHash" | "epoch" | "tags" | "group" | "locations" | "slices"
>;

/** Everything of a row except its outcome. */
export type RowBase = RowMetadata & OutputSignals & Pick<CaseResult, "startedAt" | "ms">;

/** Row metadata read from the current case, so a reused or re-scored row never keeps stale tags, locations or slices. */
export function rowMetadata<T>(
  item: EvalCase<T>,
  key: JobKey,
  slices: SliceMap<T> | undefined,
  fingerprint = caseFingerprint(item),
): RowMetadata {
  return {
    caseId: item.id,
    caseFingerprint: fingerprint,
    experiment: key.experiment,
    ...(key.configHash === undefined ? {} : { configHash: key.configHash }),
    epoch: key.epoch,
    tags: item.tags ?? {},
    ...(item.group === undefined ? {} : { group: item.group }),
    ...(item.locations === undefined ? {} : { locations: item.locations }),
    ...(slices ? { slices: sliceValues(slices, item) } : {}),
  };
}

/** Signals a stored row carries over when it is rebuilt. */
export function signalsOf(row: CaseResult): OutputSignals {
  return {
    ...(row.usage === undefined ? {} : { usage: row.usage }),
    ...(row.method === undefined ? {} : { method: row.method }),
    ...(row.fallback === undefined ? {} : { fallback: row.fallback }),
    ...(row.diagnostics === undefined ? {} : { diagnostics: row.diagnostics }),
  };
}

/** Project and score a stored output. Every path scores the JSON form, so a fresh run, a resume and a rescore agree. */
export async function scoredRow<T>(
  spec: EvalSpec<T>,
  expected: T,
  locations: EvalCase["locations"],
  stored: StoredRaw,
  project: ((raw: unknown) => T) | undefined,
  base: RowBase,
): Promise<CaseResult> {
  const actual = project ? project(stored.raw) : stored.raw;
  const score = await spec.scoreAsync(expected, actual, {
    ...(stored.confidence ? { confidence: stored.confidence } : {}),
    ...(stored.evidence ? { evidence: stored.evidence } : {}),
    ...(locations ? { locations } : {}),
  });
  return { ...base, outcome: "scored", expected: toJsonValue(expected), actual: toJsonValue(actual), score };
}

/** An errored row with every expected leaf counted as omitted. */
export async function erroredRow<T>(spec: EvalSpec<T>, expected: T, error: ErroredCase["error"], base: RowBase): Promise<CaseResult> {
  return {
    ...base,
    outcome: "errored",
    expected: toJsonValue(expected),
    error,
    omitted: omittedOf(await spec.scoreAsync(expected, undefined)),
  };
}

/** Fill a row's per-case metric values, as `buildResult` computes them, before it is appended. */
export function withValues(run: RunInfo, row: CaseResult, metrics: readonly MetricDefinition[] | undefined): CaseResult {
  return buildResult({ run, cases: [row], ...(metrics ? { metrics } : {}) }).cases[0] ?? row;
}

/** Validate every case's truth and report all failures in one error naming only the failing cases. */
export function validateTruth<T>(items: readonly { readonly id: string; readonly expected: unknown }[], spec: EvalSpec<T>): Map<string, T> {
  const values = new Map<string, T>();
  const failing = new Map<string, InvalidCaseTruth>();
  for (const item of items) {
    const result = spec.validate(item.expected);
    if (result.ok) values.set(item.id, result.value);
    else if (!failing.has(item.id)) failing.set(item.id, { caseId: item.id, issues: result.issues });
  }
  if (failing.size) throw new GroundTruthError([...failing.values()]);
  return values;
}
