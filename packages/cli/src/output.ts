/**
 * What gets printed, and where.
 *
 * stdout is data. stderr is the story: which loader read it, which strategy
 * answered, what the ones before it did, what it cost. That split is what lets the
 * same command be both `| jq` fodder and something you can watch run.
 *
 * The per-document line is one line on purpose. A batch of 500 should scroll like
 * a test run, not like a log.
 */

import type { Attempt, ExtractionResult, Usage } from "docture";
import type { Style } from "./cli/io.js";

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Money, to the cent it actually costs. Sub-cent runs are the norm for one
 * document, so four decimals rather than two — and `undefined` prints nothing at
 * all, because a missing price table is not a free run.
 */
export function formatUsd(value: number): string {
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

export function formatUsage(usage: Usage): string {
  const parts = [formatMs(usage.wallMs)];
  if (usage.totalTokens > 0) parts.push(`${formatCount(usage.totalTokens)} tokens`);
  if (usage.costUsd !== undefined) parts.push(formatUsd(usage.costUsd));
  return parts.join(" · ");
}

/** The one-line verdict for a document that worked. */
export function successLine(label: string, result: ExtractionResult<unknown>, style: Style): string {
  const fallbacks = result.attempts.filter((a) => a.status === "failed").length;
  const fallbackNote =
    fallbacks === 0 ? "" : style.yellow(` after ${fallbacks} failed attempt${fallbacks === 1 ? "" : "s"}`);
  const classification =
    result.classification === undefined
      ? ""
      : style.dim(` · ${result.classification.name} ${(result.classification.confidence * 100).toFixed(0)}%`);

  return (
    `${style.green("✓")} ${style.bold(label)} ` +
    `${style.dim("→")} ${result.method} via ${result.loader}${fallbackNote}` +
    `${classification} ${style.dim("· " + formatUsage(result.usage))}\n`
  );
}

export function failureLine(label: string, message: string, style: Style): string {
  return `${style.red("✗")} ${style.bold(label)} ${style.dim("→")} ${message}\n`;
}

/** Every attempt, in order. What `--verbose` is for: a fallback is never silent. */
export function attemptLines(attempts: readonly Attempt[], style: Style): string {
  return attempts
    .map((attempt) => {
      const mark =
        attempt.status === "ok"
          ? style.green("ok  ")
          : attempt.status === "skipped"
            ? style.dim("skip")
            : style.red("fail");
      const why = attempt.error === undefined ? "" : ` — ${attempt.error}`;
      const code = attempt.errorCode === undefined ? "" : ` [${attempt.errorCode}]`;
      return `    ${mark} ${attempt.strategy} ${style.dim(formatMs(attempt.ms))}${code}${why}\n`;
    })
    .join("");
}

/** One record in `--full` / `--format ndjson` output. */
export interface DocumentRecord {
  readonly file: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly method?: string;
  readonly loader?: string;
  readonly attempts?: readonly Attempt[];
  readonly usage?: Usage;
  readonly features?: ExtractionResult<unknown>["features"];
  readonly classification?: ExtractionResult<unknown>["classification"];
  readonly error?: { readonly code?: string; readonly message: string };
}

export function recordOf(
  file: string,
  result: ExtractionResult<unknown>,
  full: boolean,
): DocumentRecord {
  if (!full) return { file, ok: true, data: result.data };
  return {
    file,
    ok: true,
    data: result.data,
    method: result.method,
    loader: result.loader,
    attempts: result.attempts,
    usage: result.usage,
    features: result.features,
    ...(result.classification === undefined ? {} : { classification: result.classification }),
  };
}

export function errorRecord(file: string, code: string | undefined, message: string): DocumentRecord {
  return {
    file,
    ok: false,
    error: { ...(code === undefined ? {} : { code }), message },
  };
}

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function toNdjson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
