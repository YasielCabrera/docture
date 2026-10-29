import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { EvalExtractor, EvalResult, GateCheck, RunStore } from "@docture/eval";
import type { EvalConfig } from "@docture/eval/config";
import { fileRunStore, readEvalResult } from "@docture/eval/node";
import { CliError, UsageError, type ExitCode } from "../cli/errors.js";
import type { Io, Style } from "../cli/io.js";
import { loadExport } from "../load-module.js";

const FILENAMES = ["docture.eval.ts", "docture.eval.mts", "docture.eval.js", "docture.eval.mjs"] as const;
const DEFAULT_STORE = ".docture/eval";

export interface LoadedEvalConfig {
  readonly config: EvalConfig<unknown>;
  /** Absolute path of the config file. Relative paths in it resolve from its directory. */
  readonly path: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const hasMethods = (value: unknown, names: readonly string[]): boolean => isObject(value) && names.every((name) => typeof value[name] === "function");
const isProcessor = (value: unknown): boolean => isObject(value) && typeof value["id"] === "string" && typeof value["extract"] === "function";
const isPositiveInteger = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 1;

function configProblems(value: unknown): string[] {
  if (!isObject(value)) return ["the default export must be an object from defineEvalConfig"];
  const problems: string[] = [];
  if (!isObject(value["dataset"]) || typeof value["dataset"]["id"] !== "string" || typeof value["dataset"]["cases"] !== "function") {
    problems.push("dataset must have a string id and a cases() method");
  }
  if (!hasMethods(value["spec"], ["validate", "score", "scoreAsync"]) || !isObject((value["spec"] as Record<string, unknown>)["info"])) {
    problems.push("spec must be an eval spec from defineEval or looseEval");
  }
  const experiments = value["experiments"];
  if (!isObject(experiments)) problems.push("experiments must be a processor or an object of processors");
  else if (!isProcessor(experiments)) {
    const entries = Object.entries(experiments);
    if (entries.length === 0) problems.push("experiments must name at least one processor");
    for (const [id, processor] of entries) if (!isProcessor(processor)) problems.push(`experiments.${id} must have a string id and an extract() method`);
  }
  const reporters = value["reporters"];
  if (reporters !== undefined && (!Array.isArray(reporters) || !reporters.every((reporter) => hasMethods(reporter, ["onResult"])))) {
    problems.push("reporters must be an array of reporters, each with an onResult() method");
  }
  const store = value["store"];
  if (store !== undefined && typeof store !== "string" && !hasMethods(store, ["createRun", "appendCase", "writeRaw", "readRaw", "openRun", "finalize", "listRuns", "readResult"])) {
    problems.push("store must be a directory path or a run store");
  }
  const baseline = value["baseline"];
  if (baseline !== undefined && baseline !== false && typeof baseline !== "string") problems.push('baseline must be a run id, "auto" or false');
  for (const name of ["concurrency", "epochs"]) {
    if (value[name] !== undefined && !isPositiveInteger(value[name])) problems.push(`${name} must be a positive integer`);
  }
  if (value["gate"] !== undefined && !isObject(value["gate"])) problems.push("gate must be an object of thresholds and budgets");
  if (value["slices"] !== undefined && !isObject(value["slices"])) problems.push("slices must map slice names to paths or functions");
  if (value["metrics"] !== undefined && !Array.isArray(value["metrics"])) problems.push("metrics must be an array of metric definitions");
  const sections = value["sections"];
  if (sections !== undefined && (!Array.isArray(sections) || !sections.every((section) => typeof section === "function"))) {
    problems.push("sections must be an array of section functions, such as calibrationSection()");
  }
  const fallback = value["fallbackBranch"];
  if (fallback !== undefined && (typeof fallback !== "string" || fallback === "")) problems.push("fallbackBranch must be a branch name");
  if (value["enrich"] !== undefined && typeof value["enrich"] !== "function") problems.push("enrich must be a function");
  return problems;
}

/** The nearest `docture.eval.*`, walking up from `cwd`. */
export async function findEvalConfig(cwd: string): Promise<string | undefined> {
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    for (const name of FILENAMES) {
      const candidate = join(directory, name);
      if (await stat(candidate).then((info) => info.isFile(), () => false)) return candidate;
    }
    if (dirname(directory) === directory) return undefined;
  }
}

/** Load and check `--config`, or the nearest eval config. Undefined only when none exists and none was named. */
export async function findAndLoadEvalConfig(cwd: string, explicit: string | undefined): Promise<LoadedEvalConfig | undefined> {
  const path = explicit === undefined ? await findEvalConfig(cwd) : isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  if (path === undefined) return undefined;
  const loaded = await loadExport<unknown>(path, { kind: "config", cwd, names: ["config"] });
  const problems = configProblems(loaded.value);
  if (problems.length > 0) {
    throw new UsageError(
      `The eval config ${loaded.from} is invalid:${problems.map((problem) => `\n  - ${problem}`).join("")}`,
      "Export defineEvalConfig({ dataset, spec, experiments }) from @docture/eval/config.",
    );
  }
  return { config: loaded.value as EvalConfig<unknown>, path: loaded.from };
}

/** Like {@link findAndLoadEvalConfig}, but a missing config is a usage error. */
export async function loadEvalConfig(cwd: string, explicit: string | undefined): Promise<LoadedEvalConfig> {
  const loaded = await findAndLoadEvalConfig(cwd, explicit);
  if (loaded === undefined) {
    throw new UsageError(
      `No docture.eval.ts in ${cwd} or any parent directory.`,
      "Create docture.eval.ts with defineEvalConfig, pass --config <path>, or pass files to score in quick mode.",
    );
  }
  return loaded;
}

/** `--store`, else the config's store, else `.docture/eval` beside the config or in the working directory. */
export function openStore(loaded: LoadedEvalConfig | undefined, flag: string | undefined, cwd: string): RunStore {
  if (flag !== undefined) return fileRunStore(resolve(cwd, flag));
  const configured = loaded?.config.store;
  if (typeof configured === "object") return configured;
  const base = loaded === undefined ? cwd : dirname(loaded.path);
  return fileRunStore(resolve(base, configured ?? DEFAULT_STORE));
}

/** The config's processors keyed by experiment id. */
export function experimentsOf<T>(config: EvalConfig<T>): Readonly<Record<string, EvalExtractor<unknown, T>>> {
  const value = config.experiments;
  return isProcessor(value) ? { [(value as EvalExtractor<unknown, T>).id]: value as EvalExtractor<unknown, T> } : value as Readonly<Record<string, EvalExtractor<unknown, T>>>;
}

/** Keep the named experiments, rejecting an unknown id with the list of known ones. */
export function selectExperiments<T>(all: Readonly<Record<string, EvalExtractor<unknown, T>>>, ids: readonly string[]): Readonly<Record<string, EvalExtractor<unknown, T>>> {
  if (ids.length === 0) return all;
  const unknown = ids.filter((id) => !(id in all));
  if (unknown.length > 0) {
    throw new UsageError(`Unknown experiment ${unknown.join(", ")}.`, `The config defines: ${Object.keys(all).join(", ")}.`);
  }
  return Object.fromEntries(ids.map((id) => [id, all[id] as EvalExtractor<unknown, T>]));
}

/** Comma-separated values across repeated flags, trimmed and without blanks. */
export function commaList(values: readonly string[]): string[] {
  return values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter((value) => value !== "");
}

/** Read the value at a dotted path such as `tags.rendition`, for stratifying a sample. */
export function valueAt(item: unknown, path: string): string {
  let value: unknown = item;
  for (const key of path.split(".")) value = isObject(value) ? value[key] : undefined;
  return value === undefined || value === null ? "" : String(value);
}

/** The absolute run directory `arg` names, when it holds a `result.json`. */
export async function runDirectoryOf(arg: string, cwd: string): Promise<string | undefined> {
  const directory = resolve(cwd, arg);
  return await stat(join(directory, "result.json")).then((info) => info.isFile(), () => false) ? directory : undefined;
}

/**
 * A stored result: a directory holding `result.json`, `latest` for the newest complete run, or a run id.
 * A directory wins over a run id of the same name.
 */
export async function readResultArg(arg: string, store: RunStore, cwd: string): Promise<EvalResult> {
  const directory = await runDirectoryOf(arg, cwd);
  if (directory !== undefined) return readEvalResult(directory);
  return store.readResult(arg === "latest" ? await latestRunId(store) : arg);
}

/** The most recently started complete run. */
export async function latestRunId(store: Pick<RunStore, "listRuns">): Promise<string> {
  const runs = (await store.listRuns()).filter((entry) => entry.status === "complete");
  const latest = runs.map((entry, order) => ({ entry, order, started: Date.parse(entry.startedAt) || -Infinity }))
    .sort((a, b) => b.started - a.started || b.order - a.order)[0];
  if (latest === undefined) throw new CliError("The store has no complete run.", "Run `docture eval run` first, or pass --store <dir>.");
  return latest.entry.id;
}

/**
 * Exit by the gate: 0 when it passed or none ran, 1 when it failed. Failed checks go to stderr even
 * under `--quiet`, because they are why the command failed.
 */
export function gateExit(
  result: EvalResult,
  io: Io,
  style: Style,
  quiet: boolean,
  describe: (check: GateCheck) => string = (check) => check.message,
): ExitCode {
  const verdict = result.gate;
  if (verdict === undefined) {
    if (!quiet) io.diagnostic(`${style.dim("·")} No gate configured; no gate ran.\n`);
    return 0;
  }
  const failed = verdict.checks.filter((check) => check.status === "fail");
  if (verdict.pass) {
    if (!quiet) io.diagnostic(`${style.green("✓")} Gate passed: ${verdict.checks.length} check${verdict.checks.length === 1 ? "" : "s"}.\n`);
    return 0;
  }
  io.diagnostic(`${style.red("✗")} Gate failed: ${failed.length} of ${verdict.checks.length} checks.\n`);
  for (const check of failed) io.diagnostic(`  ${describe(check)}\n`);
  return 1;
}
