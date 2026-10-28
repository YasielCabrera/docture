import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ContractViolationError, ExtractionFailedError, ModelOutputError, messageOf, sumUsage } from "docture";
import {
  aggregate,
  failures,
  formatScoreboard,
  gate,
  recordRun,
  scoreExtraction,
  type RunRecord,
  type ScoreOptions,
} from "docture/eval";
import { boolFlag, choiceFlag, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { CliError, explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { OUTPUT_FORMAT } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import { expandInputs, sourcesOf, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  envelope,
  errorRecord,
  formatMs,
  formatUsd,
  reportFailure,
  reportWiring,
  successLine,
  toJson,
  toNdjson,
  type Item,
} from "../output.js";
import { resolveSchemaSource } from "../schema.js";
import { emitPlan } from "../plan.js";
import { buildWiring, planWiring, type WiringInput } from "../wiring.js";

type EvalData = Pick<RunRecord, "method" | "usage"> & {
  readonly score: Pick<RunRecord["score"], "f1" | "precision" | "recall" | "exactMatch">;
};

/**
 * Where a document's ground truth lives.
 *
 * Three rules, in order, and each is the obvious one for how a corpus tends to be
 * laid out. Nothing is inferred beyond them: a missing truth file is an error
 * naming the path that was tried, because scoring a document against nothing and
 * calling it 1.0 would be the worst possible failure for this command.
 */
async function truthPathFor(
  input: Input,
  truth: string | undefined,
  cwd: string,
  singleInput: boolean,
): Promise<string> {
  const absolute = truth === undefined ? undefined : isAbsolute(truth) ? truth : resolve(cwd, truth);
  const isDirectory = absolute !== undefined && await stat(absolute)
    .then((info) => info.isDirectory())
    .catch(() => false);

  if (input.kind === "stdin") {
    if (absolute === undefined || isDirectory) {
      throw new UsageError("eval reads stdin only with --truth <file>.", "Pass --truth ./expected.json.");
    }
    return absolute;
  }
  if (absolute === undefined) {
    const base = input.kind === "path" ? input.path : resolve(cwd, input.url);
    return join(dirname(base), `${stem(input.label)}.expected.json`);
  }

  if (isDirectory) return join(absolute, `${stem(input.label)}.json`);
  if (singleInput) return absolute;

  throw new CliError(
    `--truth "${truth}" is a file, but there are several inputs.`,
    "Point --truth at a directory of <name>.json files.",
  );
}

async function readTruth(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(
      code === "ENOENT"
        ? `No ground truth at ${path}.`
        : `Ground truth at ${path} is not valid JSON: ${messageOf(error)}`,
      code === "ENOENT" ? "Pass --truth <dir>, or put a <name>.expected.json beside the document." : undefined,
    );
  }
}

export async function evalCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const truth = stringFlag(parsed, "truth");
  const report = stringFlag(parsed, "report");
  const alignBy = stringFlag(parsed, "align-by");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const minF1 = numberFlag(parsed, "min-f1", { min: 0, max: 1 });
  const maxCostUsd = numberFlag(parsed, "max-cost-usd", { min: 0 });
  const tolerance = numberFlag(parsed, "tolerance", { min: 0 });
  const similarity = numberFlag(parsed, "string-similarity", { min: 0, max: 1 });
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });

  const scoreOptions: ScoreOptions = {
    ...(tolerance === undefined ? {} : { numericTolerance: tolerance }),
    ...(similarity === undefined ? {} : { stringSimilarity: similarity }),
    ...(alignBy === undefined ? {} : { alignArraysBy: alignBy }),
  };

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const schemaSource = await resolveSchemaSource({
    ...(schemaFlag === undefined ? {} : { specifier: schemaFlag }),
    ...(config?.config.schema === undefined ? {} : { fromConfig: config.config.schema }),
    cwd: io.cwd,
    command: "eval",
  });

  const inputs = await expandInputs(parsed.positionals, io.cwd);
  if (inputs.length > 1 && inputs.some((input) => input.kind === "stdin")) {
    throw new UsageError(
      "eval cannot mix stdin with other inputs.",
      "Score stdin and the files in separate runs.",
    );
  }

  // Every truth file is located and read UP FRONT. A corpus with one missing file
  // should fail in a second, not after paying a model for the other forty-nine.
  const expected = new Map<number, unknown>();
  const truthPaths: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const path = await truthPathFor(input, truth, io.cwd, inputs.length === 1);
    truthPaths.push(path);
    expected.set(index, await readTruth(path));
  }

  const wiringInput: WiringInput = {
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
    needsModel: true,
  };

  if (boolFlag(parsed, "dry-run")) {
    const plan = await planWiring(wiringInput);
    reportWiring(io, common, style, [...plan.notes, schemaSource.describe], [...plan.warnings, ...schemaSource.warnings]);
    return emitPlan(io, "eval", inputs, plan, (_input, index) => ({
      ...plan.pipeline,
      schema: schemaSource.origin,
      truth: truthPaths[index],
      output: { to: "stdout" },
    }));
  }

  const wiring = await buildWiring(wiringInput);
  reportWiring(io, common, style, [...wiring.notes, schemaSource.describe], [...wiring.warnings, ...schemaSource.warnings]);

  const records: RunRecord[] = [];
  const results = new Array<Item<EvalData> | undefined>(inputs.length);
  const hintsShown = new Set<string>();
  let failed = 0;

  try {
    const batch = wiring.extractor.extractBatch(
      await sourcesOf(inputs, io, signal),
      schemaSource.schema,
      {
        signal,
        concurrency: concurrency ?? wiring.concurrency,
        ...(only.length === 0 ? {} : { only }),
      },
    );

    for await (const item of batch) {
      const label = inputs[item.index]?.label ?? String(item.index);

      if (!item.outcome.ok) {
        failed += 1;
        const explained = explain(item.outcome.error);
        reportFailure(io, label, explained, style, hintsShown);
        const score = scoreExtraction(expected.get(item.index), undefined, scoreOptions);
        const error = item.outcome.error;
        const exhausted = error instanceof ExtractionFailedError || error instanceof ContractViolationError
          ? error : undefined;
        const attempts = exhausted?.attempts ?? [];
        const usage = exhausted?.usage ?? sumUsage(
          error instanceof ModelOutputError ? [error.usage] : attempts.map((attempt) => attempt.usage), 0,
        );
        records.push(recordRun(label, {
          ...score,
          f1: 0,
          precision: 0,
          recall: 0,
          exactMatch: false,
        }, { method: "failed", loader: "none", usage, attempts }));
        const record = errorRecord(label, explained);
        results[item.index] = record;
        if (format === "ndjson") io.write(toNdjson(record));
        continue;
      }

      const result = item.outcome.result;
      const score = scoreExtraction(expected.get(item.index), result.data, scoreOptions);
      records.push(recordRun(label, score, result));
      const record: Item<EvalData> = {
        file: label, ok: true,
        score: { f1: score.f1, precision: score.precision, recall: score.recall, exactMatch: score.exactMatch },
        method: result.method, usage: result.usage,
      };
      results[item.index] = record;
      if (format === "ndjson") io.write(toNdjson(record));

      if (!common.quiet) {
        const grade =
          score.f1 === 1
            ? style.green("F1 1.000")
            : score.f1 >= 0.9
              ? style.yellow(`F1 ${score.f1.toFixed(3)}`)
              : style.red(`F1 ${score.f1.toFixed(3)}`);
        io.diagnostic(successLine(`${label} ${grade}`, result, style));

        if (common.verbose) {
          for (const field of failures(score)) {
            io.diagnostic(
              `    ${style.dim(field.status.padEnd(13))} ${field.path}: ` +
                `expected ${JSON.stringify(field.expected)}, got ${JSON.stringify(field.actual)}\n`,
            );
          }
        }
      }
    }
  } finally {
    await wiring.dispose();
  }

  const scoreboard = formatScoreboard(records);
  if (format === "text") io.write(`${scoreboard}\n`);
  if (report !== undefined) {
    await writeFile(resolve(io.cwd, report), `${scoreboard}\n`, "utf8");
    if (!common.quiet) io.diagnostic(`${style.dim("→")} scoreboard written to ${report}\n`);
  }

  const summary = aggregate(records);
  if (common.verbose && !common.quiet) {
    const worst = Object.entries(summary.byField)
      .sort(([left, a], [right, b]) => a.f1 - b.f1 || left.localeCompare(right))
      .slice(0, 10);
    if (worst.length > 0) {
      io.diagnostic("Worst fields:\n");
      for (const [path, field] of worst) {
        io.diagnostic(`  ${path}  F1 ${field.f1.toFixed(3)} · precision ${field.precision.toFixed(3)} · recall ${field.recall.toFixed(3)}\n`);
      }
    }
  }
  const decision = gate(summary, {
    ...(minF1 === undefined ? {} : { minF1 }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  });
  if (format === "json") {
    const output = envelope("eval", results.filter((record) => record !== undefined), {
      ...summary, failed, ...(minF1 === undefined ? {} : { minF1 }),
      ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
      passed: failed === 0 && decision.pass, reasons: decision.reasons,
    });
    io.write(toJson({ ...output, ok: output.ok && decision.pass }));
  }
  if (!common.quiet) {
    io.diagnostic(
      `${style.dim("─")} ${summary.documents} scored · mean F1 ${summary.meanF1.toFixed(3)} · ` +
        `${summary.exactMatches} exact` +
        (summary.totalCostUsd > 0 ? ` · ${formatUsd(summary.totalCostUsd)}` : "") +
        ` · ${formatMs(summary.wallMs)}` +
        (failed === 0 ? "" : ` · ${style.red(`${failed} failed to extract`)}`) +
        "\n",
    );
  }

  if (!decision.pass) {
    throw new CliError(
      decision.reasons.join(" "),
      "Re-run with --verbose to inspect field accuracy and configure pricing to account for model cost.",
    );
  }
  return failed === 0 ? 0 : 1;
}
