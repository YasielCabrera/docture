import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { messageOf, type DocumentSource, type ExtractionResult } from "docture";
import { resolveSource } from "docture/node";
import {
  defineMetric,
  inMemoryDataset,
  looseEval,
  type CaseResult,
  type EvalCase,
  type EvalExtractor,
  type FieldGroupSummary,
  type FieldStatus,
  type GateCheck,
  type GateThreshold,
  type Reporter,
  type StatusCounts,
} from "@docture/eval";
import { calibrationSection } from "@docture/eval/calibration";
import { fromDocture } from "@docture/eval/docture";
import { md, renderMarkdown } from "@docture/eval/reporters/markdown";
import { runEval } from "@docture/eval/runner";
import { boolFlag, choiceFlag, commaList, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { CliError, explain, UsageError, type ExitCode, type Explained } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { OUTPUT_FORMAT } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import type { CliExtractor } from "../define-config.js";
import { expandInputs, stem, type Input } from "../inputs.js";
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
import { emitPlan } from "../plan.js";
import { resolveSchemaSource } from "../schema.js";
import { buildWiring, planWiring, type WiringInput } from "../wiring.js";
import { gateExit } from "./config.js";
import { resolveReporters, trackReporters } from "./reporters.js";

const EXPERIMENT = "docture";

function documentF1(row: CaseResult): number | null {
  if (row.outcome === "skipped") return null;
  return row.outcome === "errored" ? 0 : (row.score.metrics.f1 ?? 1);
}

const MEAN_DOCUMENT_F1 = defineMetric({
  id: "meanDocumentF1",
  label: "Mean document F1",
  direction: "higher",
  format: "ratio",
  perCase: documentF1,
  aggregate: (rows) => {
    const values = rows.map(documentF1).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  },
});

type DocumentData = {
  readonly score: {
    readonly f1: number | null;
    readonly precision: number | null;
    readonly recall: number | null;
    readonly exactMatch: boolean;
  };
  readonly method?: string;
  readonly usage?: ExtractionResult<unknown>["usage"];
};

async function resolveExplicitOrSiblingTruthPath(
  input: Input,
  truth: string | undefined,
  cwd: string,
  singleInput: boolean,
): Promise<string> {
  const absolute = truth === undefined ? undefined : isAbsolute(truth) ? truth : resolve(cwd, truth);
  const isDirectory =
    absolute !== undefined &&
    (await stat(absolute)
      .then((info) => info.isDirectory())
      .catch(() => false));

  if (input.kind === "stdin") {
    if (absolute === undefined || isDirectory)
      throw new UsageError("eval reads stdin only with --truth <file>.", "Pass --truth ./expected.json.");
    return absolute;
  }
  if (absolute === undefined) {
    const base = input.kind === "path" ? input.path : resolve(cwd, input.url);
    return join(dirname(base), `${stem(input.label)}.expected.json`);
  }
  if (isDirectory) return join(absolute, `${stem(input.label)}.json`);
  if (singleInput) return absolute;
  throw new CliError(`--truth "${truth}" is a file, but there are several inputs.`, "Point --truth at a directory of <name>.json files.");
}

async function readTruth(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(
      code === "ENOENT" ? `No ground truth at ${path}.` : `Ground truth at ${path} is not valid JSON: ${messageOf(error)}`,
      code === "ENOENT" ? "Pass --truth <dir>, or put a <name>.expected.json beside the document." : undefined,
    );
  }
}

async function readAllTruthBeforeModelSetup(
  inputs: readonly Input[],
  truth: string | undefined,
  cwd: string,
): Promise<{ expected: unknown[]; truthPaths: string[] }> {
  const expected: unknown[] = [];
  const truthPaths: string[] = [];
  for (const input of inputs) {
    const path = await resolveExplicitOrSiblingTruthPath(input, truth, cwd, inputs.length === 1);
    truthPaths.push(path);
    expected.push(await readTruth(path));
  }

  return { expected, truthPaths };
}

function caseIds(inputs: readonly Input[]): string[] {
  const seen = new Map<string, number>();
  return inputs.map((input) => {
    const count = (seen.get(input.label) ?? 0) + 1;
    seen.set(input.label, count);
    return count === 1 ? input.label : `${input.label} (${count})`;
  });
}

function omitPlaceholderMediaTypeForSniffing(source: DocumentSource): DocumentSource {
  if (
    typeof source !== "object" ||
    source instanceof Uint8Array ||
    source instanceof ArrayBuffer ||
    source instanceof URL ||
    !("bytes" in source)
  )
    return source;
  return { bytes: source.bytes, ...(source.fileName === undefined ? {} : { fileName: source.fileName }) };
}

function grade(f1: number | null, style: Style): string {
  if (f1 === null) return style.dim("F1 n/a");
  const text = `F1 ${f1.toFixed(3)}`;
  return f1 === 1 ? style.green(text) : f1 >= 0.9 ? style.yellow(text) : style.red(text);
}

const fixed = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : value.toFixed(3));

function worstFields(paths: Readonly<Record<string, FieldGroupSummary>>): string[] {
  return Object.entries(paths)
    .sort(([left, a], [right, b]) => (a.f1 ?? 1) - (b.f1 ?? 1) || left.localeCompare(right))
    .slice(0, 10)
    .map(
      ([path, field]) =>
        `  ${path === "" ? "(root)" : path}  F1 ${fixed(field.f1)} · precision ${fixed(field.precision)} · recall ${fixed(field.recall)}\n`,
    );
}

const SCOREBOARD_SECTIONS = [md.overview(), md.cases(), md.paths(), md.calibration(), md.gate(), md.failures(), md.warnings()];

type FieldTotals = StatusCounts & { readonly precision: number; readonly recall: number; readonly f1: number };

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * The summary keys quick mode has always emitted. Means are per document: a document that failed to
 * extract scores 0, and an empty precision or recall denominator scores 1. `byField` folds array
 * indexes into `[]` and counts a failed document's expected leaves as omissions.
 */
function documentSummary(rows: readonly CaseResult[]) {
  const scores = rows.map((row) =>
    row.outcome === "scored"
      ? { f1: row.score.metrics.f1 ?? 1, precision: row.score.metrics.precision ?? 1, recall: row.score.metrics.recall ?? 1 }
      : { f1: 0, precision: 0, recall: 0 },
  );
  const byMethod: Record<string, number> = {};
  const counts = new Map<string, Record<FieldStatus, number>>();
  const add = (path: string, status: FieldStatus, count: number): void => {
    const field = counts.get(path) ?? { match: 0, mismatch: 0, omission: 0, hallucination: 0 };
    field[status] += count;
    counts.set(path, field);
  };
  for (const row of rows) {
    const method = row.outcome === "scored" ? (row.method ?? "unknown") : "failed";
    byMethod[method] = (byMethod[method] ?? 0) + 1;
    if (row.outcome === "scored") for (const field of row.score.fields) add(field.path.replace(/\[\d+\]/g, "[]"), field.status, 1);
    if (row.outcome === "errored") for (const [pattern, omitted] of Object.entries(row.omitted.paths)) add(pattern, "omission", omitted.fields);
  }
  const byField: Record<string, FieldTotals> = {};
  for (const [path, field] of counts) {
    const predicted = field.match + field.mismatch + field.hallucination;
    const relevant = field.match + field.mismatch + field.omission;
    const precision = predicted === 0 ? 1 : field.match / predicted;
    const recall = relevant === 0 ? 1 : field.match / relevant;
    byField[path] = { ...field, precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall) };
  }
  return {
    documents: rows.length,
    meanF1: mean(scores.map((score) => score.f1)),
    meanPrecision: mean(scores.map((score) => score.precision)),
    meanRecall: mean(scores.map((score) => score.recall)),
    exactMatches: rows.filter((row) => row.outcome === "scored" && row.score.metrics.exact).length,
    totalCostUsd: rows.reduce((sum, row) => sum + (row.usage?.costUsd ?? 0), 0),
    totalTokens: rows.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0) + (row.usage?.outputTokens ?? 0), 0),
    wallMs: rows.reduce((sum, row) => sum + (row.usage?.wallMs ?? row.ms), 0),
    byMethod,
    byField,
  };
}

function dollars(value: number): string {
  const fixed = value.toFixed(4);
  return `$${Number(fixed) === value ? fixed : String(value)}`;
}

/** A failed quick-mode check in the words of its flag; any other check keeps the gate's message. */
function flagReason(check: GateCheck): string {
  if (check.kind !== "threshold" || check.value === null) return check.message;
  if (check.metric === MEAN_DOCUMENT_F1.id && check.min !== undefined)
    return `Mean F1 ${check.value.toFixed(3)} is below the --min-f1 gate of ${check.min}.`;
  if (check.metric === "costUsd" && check.max !== undefined)
    return `Total cost ${dollars(check.value)} exceeds the --max-cost-usd gate of ${dollars(check.max)}.`;
  return check.message;
}

export async function quickCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const truth = stringFlag(parsed, "truth");
  const report = stringFlag(parsed, "report");
  const alignBy = stringFlag(parsed, "align-by");
  const calibrate = boolFlag(parsed, "calibrate");
  const targetPrecision = numberFlag(parsed, "target-precision", { min: Number.MIN_VALUE, max: 1 }) ?? 0.99;
  const minSupport = numberFlag(parsed, "min-support", { min: 1, integer: true }) ?? 5;
  if (calibrate && alignBy !== undefined)
    throw new UsageError("--calibrate does not support --align-by; evidence retains original array positions.");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const minF1 = numberFlag(parsed, "min-f1", { min: 0, max: 1 });
  const maxCostUsd = numberFlag(parsed, "max-cost-usd", { min: 0 });
  const tolerance = numberFlag(parsed, "tolerance", { min: 0 });
  const similarity = numberFlag(parsed, "string-similarity", { min: 0, max: 1 });
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });
  const reporterNames = commaList(listFlag(parsed, "reporter"));

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
    throw new UsageError("eval cannot mix stdin with other inputs.", "Score stdin and the files in separate runs.");
  }

  const { expected, truthPaths } = await readAllTruthBeforeModelSetup(inputs, truth, io.cwd);

  const wiringInput: WiringInput = {
    io,
    ...(config === undefined ? {} : { config }),
    flags: { ...wiringFlags(parsed), ...(calibrate ? { citations: true } : {}) },
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

  const spec = looseEval({
    ...(tolerance === undefined ? {} : { numericTolerance: tolerance }),
    ...(similarity === undefined ? {} : { stringSimilarity: similarity }),
    ...(alignBy === undefined ? {} : { alignArraysBy: alignBy }),
  });
  const reporters = trackReporters(await resolveReporters(reporterNames, stringFlag(parsed, "out") ?? "eval-report", io.cwd));
  const wiring = await buildWiring(wiringInput);
  reportWiring(io, common, style, [...wiring.notes, schemaSource.describe], [...wiring.warnings, ...schemaSource.warnings]);

  const ids = caseIds(inputs);
  let stdin: Promise<Uint8Array> | undefined;
  const bytesOf = async (input: Input): Promise<Uint8Array> => {
    if (input.kind === "stdin") return (stdin ??= io.readStdin(signal));
    return new Uint8Array((await resolveSource(input.kind === "path" ? input.path : input.url, signal)).bytes);
  };
  const cases: EvalCase<unknown>[] = inputs.map((input, index) => ({
    id: ids[index] ?? input.label,
    expected: expected[index],
    documents: [{ name: input.label, mimeType: "application/octet-stream", bytes: () => bytesOf(input) }],
  }));

  const extractor: Pick<CliExtractor, "extract" | "dispose"> = {
    extract: (source, contract, options) =>
      wiring.extractor.extract(omitPlaceholderMediaTypeForSniffing(source), contract, {
        ...options,
        ...(only.length === 0 ? {} : { only }),
      }),
    dispose: () => wiring.dispose(),
  };
  const docture = fromDocture(extractor, schemaSource.schema, { id: EXPERIMENT });
  const extractions = new Map<string, ExtractionResult<unknown>>();
  const thrown = new Map<string, unknown>();
  const processor: EvalExtractor<ExtractionResult<unknown>, unknown> = {
    ...docture,
    async extract(input, context) {
      try {
        const output = await docture.extract(input, context);
        extractions.set(input.id, output.raw);
        return output;
      } catch (error) {
        thrown.set(input.id, error);
        throw error;
      }
    },
  };

  const records = new Array<Item<DocumentData> | undefined>(inputs.length);
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  const hintsShown = new Set<string>();
  let failed = 0;
  const documents: Reporter = {
    id: "documents",
    onCase(row: CaseResult) {
      const index = indexOf.get(row.caseId) ?? 0;
      const label = inputs[index]?.label ?? row.caseId;
      let record: Item<DocumentData>;
      if (row.outcome === "scored") {
        const extraction = extractions.get(row.caseId);
        const metrics = row.score.metrics;
        record = {
          file: label,
          ok: true,
          score: { f1: metrics.f1, precision: metrics.precision, recall: metrics.recall, exactMatch: metrics.exact },
          ...(extraction === undefined ? {} : { method: extraction.method, usage: extraction.usage }),
        };
        if (!common.quiet && extraction !== undefined)
          io.diagnostic(successLine(`${label} ${grade(metrics.f1, style)}`, extraction, style));
        if (common.verbose && !common.quiet) {
          for (const field of row.score.fields.filter((item) => item.status !== "match")) {
            io.diagnostic(
              `    ${style.dim(field.status.padEnd(13))} ${field.path}: expected ${JSON.stringify(field.expected)}, got ${JSON.stringify(field.actual)}\n`,
            );
          }
        }
      } else {
        failed += 1;
        const cause = thrown.get(row.caseId);
        const explained: Explained =
          cause !== undefined
            ? explain(cause)
            : row.outcome === "errored"
              ? { code: row.error.code ?? "INTERNAL", message: row.error.message }
              : { code: "OUT_OF_SCOPE", message: row.reason };
        reportFailure(io, label, explained, style, hintsShown);
        record = errorRecord(label, explained);
      }
      records[index] = record;
      if (format === "ndjson") io.write(toNdjson(record));
    },
    onResult() {},
  };

  const thresholds: GateThreshold[] = [
    ...(minF1 === undefined ? [] : [{ metric: MEAN_DOCUMENT_F1.id, min: minF1 }]),
    ...(maxCostUsd === undefined ? [] : [{ metric: "costUsd", max: maxCostUsd }]),
  ];
  const result = await runEval({
    dataset: inMemoryDataset("quick", cases),
    spec,
    experiments: processor,
    signal,
    concurrency: concurrency ?? wiring.concurrency,
    reporters: [documents, ...reporters.reporters],
    metrics: [MEAN_DOCUMENT_F1],
    ...(calibrate ? { sections: [calibrationSection({ targetPrecision, minSupport })] } : {}),
    ...(thresholds.length === 0 || boolFlag(parsed, "no-gate") ? {} : { gate: { thresholds } }),
  });

  const scoreboard = renderMarkdown(result, { title: "Eval scoreboard", sections: SCOREBOARD_SECTIONS });
  if (format === "text") io.write(scoreboard);
  if (report !== undefined) {
    await writeFile(resolve(io.cwd, report), scoreboard, "utf8");
    if (!common.quiet) io.diagnostic(`${style.dim("→")} scoreboard written to ${report}\n`);
  }

  const summary = result.summary[EXPERIMENT];
  const overall = summary?.overall ?? {};
  if (common.verbose && !common.quiet && summary !== undefined) {
    const worst = worstFields(summary.paths);
    if (worst.length > 0) io.diagnostic(`Worst fields:\n${worst.join("")}`);
  }
  const reasons = (result.gate?.checks ?? []).filter((check) => check.status === "fail").map(flagReason);
  const passed = failed === 0 && result.gate?.pass !== false;
  if (format === "json") {
    const output = envelope(
      "eval",
      records.filter((record) => record !== undefined),
      {
        ...documentSummary(result.cases),
        failed,
        runId: result.run.id,
        metrics: overall,
        fields: summary?.paths ?? {},
        ...(result.calibration === undefined ? {} : { calibration: result.calibration }),
        ...(minF1 === undefined ? {} : { minF1 }),
        ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
        gate: result.gate ?? null,
        passed,
        reasons,
      },
    );
    io.write(toJson({ ...output, ok: output.ok && passed }));
  }
  if (!common.quiet) {
    const exact = result.cases.filter((row) => row.outcome === "scored" && row.score.metrics.exact).length;
    const cost = overall["costUsd"];
    const wallMs = result.cases.reduce((sum, row) => sum + row.ms, 0);
    io.diagnostic(
      `${style.dim("─")} ${inputs.length} document${inputs.length === 1 ? "" : "s"} · mean document F1 ${fixed(overall[MEAN_DOCUMENT_F1.id])} · field F1 ${fixed(overall["f1"])} · ${exact} exact` +
        (cost === undefined || cost === null || cost === 0 ? "" : ` · ${formatUsd(cost)}`) +
        ` · ${formatMs(wallMs)}` +
        (failed === 0 ? "" : ` · ${style.red(`${failed} failed to extract`)}`) +
        "\n",
    );
  }
  const verdict = gateExit(result, io, style, common.quiet, flagReason);
  const delivered = reporters.report(io, style);
  return verdict === 1 || delivered === 1 || failed > 0 || result.run.status !== "complete" ? 1 : 0;
}
