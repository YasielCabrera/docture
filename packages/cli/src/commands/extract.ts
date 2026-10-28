/**
 * `docture extract` — the headline command.
 *
 * Reads N documents, writes the extracted data to stdout, narrates to stderr.
 * A single bad document never sinks the run: core's `extractBatch` yields failures
 * as values, so one corrupt scan in a batch of 500 loses that one and not the other
 * 499 — and the exit code still says something failed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtractionResult, Usage } from "docture";
import { boolFlag, choiceFlag, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { OUTPUT_FORMAT } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import { describeInput, expandInputs, sourcesOf, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import { localInputs, refuseInputAliases, refuseMissingLeafAliases } from "../output-safety.js";
import {
  attemptLines,
  envelope,
  errorRecord,
  reportFailure,
  reportWiring,
  formatCount,
  formatMs,
  formatUsd,
  recordOf,
  successLine,
  toJson,
  toNdjson,
  type DocumentRecord,
} from "../output.js";
import { emitPlan } from "../plan.js";
import { resolveSchemaSource } from "../schema.js";
import { buildWiring, planWiring, type WiringInput } from "../wiring.js";

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
        `"${clash}" and "${describeInput(input)}" would both be written to ${path}.`,
        "Rename one, or drop --out and use --format ndjson.",
      );
    }
    taken.set(path, describeInput(input));
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
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "json";
  const full = boolFlag(parsed, "full");
  if (boolFlag(parsed, "citations") && !full) {
    throw new UsageError(
      "--citations needs --full: citations are written only to the full result record.",
      "Add --full.",
    );
  }
  const out = stringFlag(parsed, "out");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const concurrencyFlag = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });
  const dryRun = boolFlag(parsed, "dry-run");

  const inputs = await expandInputs(parsed.positionals, io.cwd);

  // `--out` is a file for one document and a directory for many. An explicit
  // trailing slash forces the directory reading even for one.
  const perFile = out !== undefined && (inputs.length > 1 || out.endsWith("/"));
  // Resolve the layout BEFORE the first model call, so a name collision costs
  // nothing rather than everything.
  const targets = perFile && out !== undefined ? outputPaths(inputs, out, io.cwd) : undefined;
  const outFile = out !== undefined && !perFile ? resolve(io.cwd, out) : undefined;
  const outputs = targets ? [...targets.values()] : outFile ? [outFile] : [];
  const local = localInputs(inputs);
  await refuseInputAliases(local, outputs);
  if (perFile && !dryRun) {
    for (const parent of new Set(outputs.map((path) => dirname(path)))) {
      await mkdir(parent, { recursive: true });
    }
    await refuseInputAliases(local, outputs);
  }
  await refuseMissingLeafAliases(local, outputs);

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

  const wiringInput: WiringInput = {
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
    needsModel: true,
  };

  if (dryRun) {
    const plan = await planWiring(wiringInput);
    reportWiring(io, common, style, [...plan.notes, schemaSource.describe], [...plan.warnings, ...schemaSource.warnings]);
    return emitPlan(io, "extract", inputs, plan, (_input, index) => {
      const path = targets?.get(index) ?? outFile;
      return {
        ...plan.pipeline,
        schema: schemaSource.origin,
        output: path === undefined ? { to: "stdout" } : { to: "file", path },
      };
    });
  }

  const wiring = await buildWiring(wiringInput);
  reportWiring(io, common, style, [...wiring.notes, schemaSource.describe], [...wiring.warnings, ...schemaSource.warnings]);

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
      await sourcesOf(inputs, io, signal),
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
        if (format === "text") emit(`${label}\n${toJson(result.data)}`);
        const path = targets?.get(item.index);
        if (path !== undefined) await writeJson(path, record);
      } else {
        failed += 1;
        const error = item.outcome.error;
        const explained = explain(error);
        const record = errorRecord(label, explained);
        records[item.index] = record;

        reportFailure(io, label, explained, style, hintsShown);
        if (format === "ndjson") emit(toNdjson(record));
        const path = targets?.get(item.index);
        if (path !== undefined) await writeJson(path, record);
      }
    }
  } finally {
    await wiring.dispose();
  }

  if (format === "json") {
    const ordered = records.filter((record): record is DocumentRecord => record !== undefined);
    emit(toJson(envelope("extract", ordered)));
  }

  if (outFile !== undefined && collected.length > 0) {
    await writeFile(outFile, collected, "utf8");
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
