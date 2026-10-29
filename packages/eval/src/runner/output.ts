import { RunStoreError } from "../errors.js";
import type { FieldEvidence, UsageInfo } from "../extractor.js";
import { isPlainObject, toJsonValue, type JsonValue } from "../json.js";
import type { StoredRaw } from "../store.js";

/** What a row keeps from a processor's answer besides the scored value. */
export interface OutputSignals {
  readonly usage?: UsageInfo;
  readonly method?: string;
  readonly fallback?: boolean;
  readonly diagnostics?: JsonValue;
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const USAGE_KEYS = ["inputTokens", "outputTokens", "calls", "pages", "costUsd", "wallMs"] as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseUsage(value: unknown): Parsed<UsageInfo> {
  if (!isPlainObject(value)) return { ok: false, problem: "usage must be an object" };
  const usage: Partial<Record<(typeof USAGE_KEYS)[number], number>> = {};
  for (const key of USAGE_KEYS) {
    const member = value[key];
    if (member === undefined) continue;
    if (!finite(member)) return { ok: false, problem: `usage.${key} must be a finite number` };
    usage[key] = member;
  }
  return { ok: true, value: usage };
}

function parseConfidence(value: unknown): Parsed<Readonly<Record<string, number>>> {
  if (!isPlainObject(value)) return { ok: false, problem: "confidence must be an object" };
  for (const [path, member] of Object.entries(value)) {
    if (!finite(member) || member < 0 || member > 1)
      return { ok: false, problem: `confidence[${JSON.stringify(path)}] must be a number from 0 to 1` };
  }
  return { ok: true, value: Object.fromEntries(Object.entries(value).map(([path, member]) => [path, Number(member)])) };
}

function parseEvidence(value: unknown): Parsed<readonly FieldEvidence[]> {
  if (!Array.isArray(value)) return { ok: false, problem: "evidence must be an array" };
  const out: FieldEvidence[] = [];
  for (const [index, item] of value.entries()) {
    const at = `evidence[${index}]`;
    if (!isPlainObject(item) || typeof item.path !== "string") return { ok: false, problem: `${at}.path must be a string` };
    if (!Number.isSafeInteger(item.pageNumber) || Number(item.pageNumber) < 1)
      return { ok: false, problem: `${at}.pageNumber must be a positive integer` };
    const box = item.box;
    if (box !== undefined && !(isPlainObject(box) && finite(box.x) && finite(box.y) && finite(box.width) && finite(box.height)))
      return { ok: false, problem: `${at}.box must have finite x, y, width and height` };
    if (item.status !== undefined && typeof item.status !== "string") return { ok: false, problem: `${at}.status must be a string` };
    if (item.confidence !== undefined && !finite(item.confidence))
      return { ok: false, problem: `${at}.confidence must be a finite number` };
    out.push({
      path: item.path,
      pageNumber: Number(item.pageNumber),
      ...(isPlainObject(box) ? { box: { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) } } : {}),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
      ...(finite(item.confidence) ? { confidence: item.confidence } : {}),
    });
  }
  return { ok: true, value: out };
}

function parseScoringSignals(value: Record<string, unknown>): Parsed<Pick<StoredRaw, "confidence" | "evidence">> {
  const confidence = value.confidence === undefined ? undefined : parseConfidence(value.confidence);
  if (confidence && !confidence.ok) return confidence;
  const evidence = value.evidence === undefined ? undefined : parseEvidence(value.evidence);
  if (evidence && !evidence.ok) return evidence;
  return {
    ok: true,
    value: { ...(confidence ? { confidence: confidence.value } : {}), ...(evidence ? { evidence: evidence.value } : {}) },
  };
}

/**
 * The usage a failing processor attached to what it threw, such as Docture's `ExtractionFailedError.usage`.
 * Absent when the thrown value has no `usage` member; a problem when it has one that is not valid usage.
 */
export function parseFailureUsage(thrown: unknown): Parsed<UsageInfo | undefined> {
  if (typeof thrown !== "object" || thrown === null || !("usage" in thrown) || thrown.usage === undefined)
    return { ok: true, value: undefined };
  return parseUsage(thrown.usage);
}

/**
 * Check a processor's answer at the boundary and keep only the members of `ExtractOutput`, so a row
 * always survives a save and reload. A problem is a sentence fragment for the errored row's message.
 */
export function parseProcessorOutput(output: unknown): Parsed<{ readonly stored: StoredRaw; readonly signals: OutputSignals }> {
  if (typeof output !== "object" || output === null) return { ok: false, problem: "the output must be an object with a raw member" };
  const value: Record<string, unknown> = Object.fromEntries(Object.entries(output));
  const usage = value.usage === undefined ? undefined : parseUsage(value.usage);
  if (usage && !usage.ok) return usage;
  if (value.method !== undefined && typeof value.method !== "string") return { ok: false, problem: "method must be a string" };
  if (value.fallback !== undefined && typeof value.fallback !== "boolean") return { ok: false, problem: "fallback must be a boolean" };
  const scoring = parseScoringSignals(value);
  if (!scoring.ok) return scoring;
  const signals: OutputSignals = {
    ...(usage ? { usage: usage.value } : {}),
    ...(typeof value.method === "string" ? { method: value.method } : {}),
    ...(typeof value.fallback === "boolean" ? { fallback: value.fallback } : {}),
    ...(value.diagnostics === undefined ? {} : { diagnostics: toJsonValue(value.diagnostics) }),
  };
  return { ok: true, value: { stored: { raw: toJsonValue(value.raw), ...scoring.value }, signals } };
}

/** Check a raw output read back from storage. Throws {@link RunStoreError} with reason `format` naming the job. */
export function parseStoredRaw(value: unknown, job: string): StoredRaw {
  const invalid = (problem: string): never => {
    throw new RunStoreError(`Stored raw output ${job} is invalid: ${problem}.`, "format");
  };
  if (!isPlainObject(value) || !("raw" in value)) return invalid("it has no raw member");
  const scoring = parseScoringSignals(value);
  if (!scoring.ok) return invalid(scoring.problem);
  for (const member of ["configHash", "caseFingerprint"] as const) {
    if (value[member] !== undefined && typeof value[member] !== "string") invalid(`${member} must be a string`);
  }
  return {
    raw: value.raw,
    ...scoring.value,
    ...(typeof value.configHash === "string" ? { configHash: value.configHash } : {}),
    ...(typeof value.caseFingerprint === "string" ? { caseFingerprint: value.caseFingerprint } : {}),
  };
}
