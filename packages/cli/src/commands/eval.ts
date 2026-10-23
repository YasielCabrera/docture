/**
 * `docture eval` — extract a corpus and score it against ground truth.
 *
 * The scoring is `docture/eval`'s, unchanged: the same precision/recall/F1 over
 * leaf paths that the library's own tests assert on. A CLI that graded differently
 * from the test suite would be worse than no CLI at all — you would have two
 * numbers and no way to reconcile them.
 *
 * `--min-f1` is the point of the command. It turns "did that prompt change help?"
 * into an exit code a CI job can gate on.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { messageOf } from "docture";
import {
  aggregate,
  failures,
  formatScoreboard,
  recordRun,
  scoreExtraction,
  type RunRecord,
  type ScoreOptions,
} from "docture/eval";
import { listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { CliError, explain, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import { failureLine, formatMs, formatUsd, successLine } from "../output.js";
import { resolveSchemaSource } from "../schema.js";
import { buildWiring } from "../wiring.js";

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
  if (truth === undefined) {
    const base = isAbsolute(input.source) ? input.source : resolve(cwd, input.source);
    return join(dirname(base), `${stem(input.label)}.expected.json`);
  }

  const absolute = isAbsolute(truth) ? truth : resolve(cwd, truth);
  const isDirectory = await stat(absolute)
    .then((info) => info.isDirectory())
    .catch(() => false);

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
  const truth = stringFlag(parsed, "truth");
  const report = stringFlag(parsed, "report");
  const alignBy = stringFlag(parsed, "align-by");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const minF1 = numberFlag(parsed, "min-f1", { min: 0, max: 1 });
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

  // Every truth file is located and read UP FRONT. A corpus with one missing file
  // should fail in a second, not after paying a model for the other forty-nine.
  const expected = new Map<number, unknown>();
  for (const [index, input] of inputs.entries()) {
    const path = await truthPathFor(input, truth, io.cwd, inputs.length === 1);
    expected.set(index, await readTruth(path));
  }

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

  const records: RunRecord[] = [];
  let failed = 0;

  try {
    const batch = wiring.extractor.extractBatch(
      inputs.map((input) => input.source),
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
        if (!common.quiet) io.diagnostic(failureLine(label, explained.message, style));
        continue;
      }

      const result = item.outcome.result;
      const score = scoreExtraction(expected.get(item.index), result.data, scoreOptions);
      records.push(recordRun(label, score, result));

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
  io.write(`${scoreboard}\n`);
  if (report !== undefined) {
    await writeFile(resolve(io.cwd, report), `${scoreboard}\n`, "utf8");
    if (!common.quiet) io.diagnostic(`${style.dim("→")} scoreboard written to ${report}\n`);
  }

  const summary = aggregate(records);
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

  if (minF1 !== undefined && summary.meanF1 < minF1) {
    throw new CliError(
      `Mean F1 ${summary.meanF1.toFixed(3)} is below the --min-f1 gate of ${minF1}.`,
      "Re-run with --verbose to see which fields missed.",
    );
  }
  return failed === 0 ? 0 : 1;
}
