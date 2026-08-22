/**
 * `docture extract` — the headline command.
 *
 * Reads N documents, writes the extracted data to stdout, narrates to stderr.
 * A single bad document never sinks the run: core's `extractBatch` yields failures
 * as values, so one corrupt scan in a batch of 500 loses that one and not the other
 * 499 — and the exit code still says something failed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { errorCodeOf, messageOf, type ExtractionResult, type Usage } from "@docture/core";
import { boolFlag, choiceFlag, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  attemptLines,
  errorRecord,
  failureLine,
  formatCount,
  formatMs,
  formatUsd,
  recordOf,
  successLine,
  toJson,
  toNdjson,
  type DocumentRecord,
} from "../output.js";
import { resolveSchemaSource } from "../schema.js";
import { buildWiring } from "../wiring.js";

const FORMATS = ["json", "ndjson"] as const;

/** Where each document goes when `--out` names a directory. */
function outputPaths(inputs: readonly Input[], out: string, cwd: string): Map<number, string> {
  const paths = new Map<number, string>();
  const taken = new Map<string, string>();

  inputs.forEach((input, index) => {
    const path = resolve(cwd, join(out, `${stem(input.label)}.json`));
    const clash = taken.get(path);
    if (clash !== undefined) {
      // Two inputs with the same basename would overwrite each other, and the
      // survivor would look exactly like a complete run.
      throw new UsageError(
        `"${clash}" and "${input.source}" would both be written to ${path}.`,
        "Rename one, or drop --out and use --format ndjson.",
      );
    }
    taken.set(path, input.source);
    paths.set(index, path);
  });

  return paths;
}

function sumUsage(results: readonly ExtractionResult<unknown>[]): Usage {
  const costs = results.map((r) => r.usage.costUsd).filter((c): c is number => c !== undefined);
  return {
    inputTokens: results.reduce((sum, r) => sum + r.usage.inputTokens, 0),
    outputTokens: results.reduce((sum, r) => sum + r.usage.outputTokens, 0),
    totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
    wallMs: results.reduce((sum, r) => sum + r.usage.wallMs, 0),
    ...(costs.length === 0 ? {} : { costUsd: costs.reduce((sum, c) => sum + c, 0) }),
  };
}

function summaryLine(
  total: number,
  failed: number,
  successes: readonly ExtractionResult<unknown>[],
  style: Style,
): string {
  const usage = sumUsage(successes);
  const parts = [
    `${total} documents`,
    failed === 0 ? style.green("all ok") : style.red(`${failed} failed`),
  ];
  if (usage.totalTokens > 0) parts.push(`${formatCount(usage.totalTokens)} tokens`);
  if (usage.costUsd !== undefined) parts.push(formatUsd(usage.costUsd));
  parts.push(formatMs(usage.wallMs));
  return `${style.dim("─")} ${parts.join(" · ")}\n`;
}

export async function extractCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, "format", FORMATS) ?? "json";
  const full = boolFlag(parsed, "full");
  const out = stringFlag(parsed, "out");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const concurrencyFlag = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const schemaSource = await resolveSchemaSource({
    ...(schemaFlag === undefined ? {} : { specifier: schemaFlag }),
    ...(config?.config.schema === undefined ? {} : { fromConfig: config.config.schema }),
    cwd: io.cwd,
    command: "extract",
  });

  const inputs = await expandInputs(parsed.positionals, io.cwd);

  // `--out` is a file for one document and a directory for many. An explicit
  // trailing slash forces the directory reading even for one.
  const perFile = out !== undefined && (inputs.length > 1 || out.endsWith("/"));
  // Resolve the layout BEFORE the first model call, so a name collision costs
  // nothing rather than everything.
  const targets = perFile && out !== undefined ? outputPaths(inputs, out, io.cwd) : undefined;

  const wiring = await buildWiring({
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
    needsModel: true,
  });

  if (!common.quiet) {
    if (common.verbose) {
      for (const note of [...wiring.notes, schemaSource.describe]) {
        io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
      }
    }
    for (const warning of [...wiring.warnings, ...schemaSource.warnings]) {
      io.diagnostic(`${style.yellow("!")} ${warning}\n`);
    }
  }

  /**
   * Stream to stdout — unless `--out` is taking it. Three cases, and only one of
   * them writes to the terminal: no `--out` at all; one `--out` file collecting
   * the whole run; a directory, where each document is written as it finishes and
   * this sink is silent.
   */
  let collected = "";
  const emit = (chunk: string): void => {
    if (perFile) return;
    if (out === undefined) io.write(chunk);
    else collected += chunk;
  };

  const records = new Array<DocumentRecord | undefined>(inputs.length);
  const successes: ExtractionResult<unknown>[] = [];
  const hintsShown = new Set<string>();
  let failed = 0;

  try {
    const batch = wiring.extractor.extractBatch(
      inputs.map((input) => input.source),
      schemaSource.schema,
      {
        signal,
        concurrency: concurrencyFlag ?? wiring.concurrency,
        ...(only.length === 0 ? {} : { only }),
      },
    );

    for await (const item of batch) {
      const label = inputs[item.index]?.label ?? String(item.index);

      if (item.outcome.ok) {
        const result = item.outcome.result;
        successes.push(result);
        const record = recordOf(label, result, full);
        records[item.index] = record;

        if (!common.quiet) {
          io.diagnostic(successLine(label, result, style));
          if (common.verbose) io.diagnostic(attemptLines(result.attempts, style));
        }
        if (format === "ndjson") emit(toNdjson(record));
        const path = targets?.get(item.index);
        if (path !== undefined) await writeJson(path, full ? record : record.data);
      } else {
        failed += 1;
        const error = item.outcome.error;
        const explained = explain(error);
        const record = errorRecord(label, errorCodeOf(error), explained.message);
        records[item.index] = record;

        if (!common.quiet) {
          io.diagnostic(failureLine(label, explained.message, style));
          // One hint per distinct failure code: the fix is the same for all of
          // them, and 500 copies of it is not more helpful than one.
          const key = explained.code ?? explained.message;
          if (explained.hint !== undefined && !hintsShown.has(key)) {
            hintsShown.add(key);
            io.diagnostic(`  ${style.dim(explained.hint)}\n`);
          }
        }
        if (format === "ndjson") emit(toNdjson(record));
      }
    }
  } finally {
    await wiring.dispose();
  }

  // `json` describes the whole run, so it can only be written once it is over.
  if (format === "json") {
    const ordered = records.filter((record): record is DocumentRecord => record !== undefined);
    const single = inputs.length === 1 ? ordered[0] : undefined;

    if (single === undefined) {
      emit(toJson(ordered));
    } else if (full || single.ok) {
      emit(toJson(full ? single : single.data));
    }
    // One document that failed, without --full: nothing goes to stdout. The error
    // is on stderr and the exit code carries it — an empty file or a `null` would
    // both read as "this document contains nothing".
  }

  if (out !== undefined && !perFile && collected.length > 0) {
    await writeFile(resolve(io.cwd, out), collected, "utf8");
  }

  if (!common.quiet) {
    if (inputs.length > 1) io.diagnostic(summaryLine(inputs.length, failed, successes, style));
    if (out !== undefined && (collected.length > 0 || perFile)) {
      io.diagnostic(`${style.dim("→")} written to ${out}\n`);
    }
  }

  return failed === 0 ? 0 : 1;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(payload), "utf8");
}
