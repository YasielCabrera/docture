import { omittedOf, toJsonValue, type CaseResult, type EvalSpec, type RunInfo, type UsageInfo } from "../../src/index.js";
import { invoiceSpec, type InvoiceView } from "./invoice.js";

const startedAt = "2026-10-28T12:00:00.000Z";

export function runInfo(experiments: readonly string[], epochs = 1, spec: EvalSpec = invoiceSpec): RunInfo {
  return {
    id: "run-1",
    status: "complete",
    startedAt,
    finishedAt: "2026-10-28T12:05:00.000Z",
    git: { branch: "main", sha: "8d04891", dirty: false },
    dataset: { id: "invoices", size: 3, fingerprint: "00000000000000aa" },
    spec: spec.info,
    experiments: experiments.map((id) => ({ id, configHash: `${id}-config` })),
    epochs,
  };
}

interface RowOptions {
  readonly experiment: string;
  readonly caseId: string;
  readonly epoch?: number;
  readonly rendition: string;
  readonly group: string;
  readonly ms: number;
  readonly usage?: UsageInfo;
  readonly fallback?: boolean;
}

function base(options: RowOptions) {
  return {
    caseId: options.caseId,
    experiment: options.experiment,
    epoch: options.epoch ?? 0,
    tags: { rendition: options.rendition },
    group: options.group,
    slices: { rendition: options.rendition },
    startedAt,
    ms: options.ms,
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
  };
}

export function scored(options: RowOptions, expected: InvoiceView, actual: unknown, spec: EvalSpec<InvoiceView> = invoiceSpec): CaseResult {
  return { ...base(options), outcome: "scored", expected: toJsonValue(expected), actual: toJsonValue(actual), score: spec.score(expected, actual) };
}

export function errored(options: RowOptions, expected: InvoiceView): CaseResult {
  return {
    ...base(options),
    outcome: "errored",
    expected: toJsonValue(expected),
    error: { name: "ExtractionFailedError", code: "EXTRACTION_FAILED", message: "Every extraction strategy failed." },
    omitted: omittedOf(invoiceSpec.score(expected, undefined)),
  };
}

export function skipped(options: RowOptions, reason: string): CaseResult {
  return { ...base(options), outcome: "skipped", reason };
}
