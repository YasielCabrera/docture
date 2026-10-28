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

import { stripVTControlCharacters } from "node:util";
import type { Attempt, ExtractionResult, Usage } from "docture";
import type { Explained } from "./cli/errors.js";
import type { Io, Style } from "./cli/io.js";

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

export function reportFailure(
  io: Io,
  label: string,
  error: Explained,
  style: Style,
  hintsShown: Set<string>,
): void {
  io.diagnostic(failureLine(label, error.message, style));
  const key = error.code;
  if (error.hint !== undefined && !hintsShown.has(key)) {
    hintsShown.add(key);
    io.diagnostic(`  ${style.dim(error.hint)}\n`);
  }
}

/** The wiring notes under `--verbose`, and its warnings unless `--quiet`. */
export function reportWiring(
  io: Io,
  options: { readonly verbose: boolean; readonly quiet: boolean },
  style: Style,
  notes: readonly string[],
  warnings: readonly string[],
): void {
  if (options.quiet) return;
  if (options.verbose) {
    for (const note of notes) io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
  }
  for (const warning of warnings) io.diagnostic(`${style.yellow("!")} ${warning}\n`);
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

export type Command = "extract" | "convert" | "classify" | "inspect" | "eval" | "review" | "help" | "paperless";

export interface FailedItem {
  readonly file: string;
  readonly ok: false;
  readonly error: Explained;
}

export type Item<R> = ({ readonly file: string; readonly ok: true } & R) | FailedItem;

export interface Envelope<R, S = never> {
  readonly version: 1;
  readonly command: Command;
  readonly ok: boolean;
  readonly results: readonly Item<R>[];
  readonly summary?: S;
}

export function envelope<R, S = never>(
  command: Command,
  results: readonly Item<R>[],
  summary?: S,
): Envelope<R, S> {
  return {
    version: 1,
    command,
    ok: results.every((item) => item.ok),
    results,
    ...(summary === undefined ? {} : { summary }),
  };
}

export interface ExtractionData {
  readonly sourceDigest?: string;
  readonly physicalSourceDigest?: string;
  readonly sourceMetadata?: Readonly<Record<string, unknown>>;
  readonly data: unknown;
  readonly method?: string;
  readonly loader?: string;
  readonly attempts?: readonly Attempt[];
  readonly usage?: Usage;
  readonly features?: ExtractionResult<unknown>["features"];
  readonly classification?: ExtractionResult<unknown>["classification"];
  readonly validation?: ExtractionResult<unknown>["validation"];
  readonly conflicts?: ExtractionResult<unknown>["conflicts"];
  readonly citations?: ExtractionResult<unknown>["citations"];
  readonly citationSources?: ExtractionResult<unknown>["citationSources"];
  readonly evidenceSources?: ExtractionResult<unknown>["evidenceSources"];
}

export type DocumentRecord = Item<ExtractionData>;

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
    ...(result.sourceDigest === undefined ? {} : { sourceDigest: result.sourceDigest }),
    ...(result.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: result.physicalSourceDigest }),
    ...(result.sourceMetadata === undefined ? {} : { sourceMetadata: result.sourceMetadata }),
    attempts: result.attempts,
    usage: result.usage,
    features: result.features,
    ...(result.classification === undefined ? {} : { classification: result.classification }),
    validation: result.validation,
    ...(result.conflicts === undefined ? {} : { conflicts: result.conflicts }),
    ...(result.citations === undefined ? {} : { citations: result.citations }),
    ...(result.citationSources === undefined ? {} : { citationSources: result.citationSources }),
    ...(result.evidenceSources === undefined ? {} : { evidenceSources: result.evidenceSources }),
  };
}

export function errorRecord(file: string, error: Explained): FailedItem {
  return {
    file, ok: false,
    error: {
      code: error.code,
      message: stripVTControlCharacters(error.message),
      ...(error.hint === undefined ? {} : { hint: stripVTControlCharacters(error.hint) }),
    },
  };
}

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function toNdjson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
