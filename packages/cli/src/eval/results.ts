import { gate, resolveBaseline, type EvalResult, type RunIndexEntry, type RunStore } from "@docture/eval";
import { compareRuns } from "@docture/eval/compare";
import { md, renderMarkdown } from "@docture/eval/reporters/markdown";
import { renderJson } from "@docture/eval/reporters/json";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { runDirectory } from "@docture/eval/node";
import { rescore } from "@docture/eval/runner";
import { boolFlag, choiceFlag, listFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { COMPARE_FORMAT, COMPARE_TEST } from "../cli/specs.js";
import { commonOptions } from "../options.js";
import { commaList, experimentsOf, findAndLoadEvalConfig, gateExit, loadEvalConfig, openStore, readResultArg, runDirectoryOf } from "./config.js";
import { deliver, resolveReporters } from "./reporters.js";

const formatOf = (parsed: Parsed): "text" | "json" => (stringFlag(parsed, "format") === "json" ? "json" : "text");

function positional(parsed: Parsed, index: number, name: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new UsageError(`Missing <${name}>.`, `Run \`docture ${parsed.spec.name} --help\`.`);
  return value;
}

async function loadConfigAndOpenRunStore(parsed: Parsed, io: Io) {
  const loaded = await findAndLoadEvalConfig(io.cwd, stringFlag(parsed, "config"));
  return { loaded, store: openStore(loaded, stringFlag(parsed, "store"), io.cwd) };
}

/** `docture eval report`: render a stored run again, or re-score it as a new run with `--rescore`. */
export async function reportCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const target = positional(parsed, 0, "run");
  let { loaded, store } = await loadConfigAndOpenRunStore(parsed, io);
  let result = await readResultArg(target, store, io.cwd);
  if (boolFlag(parsed, "rescore")) {
    loaded ??= await loadEvalConfig(io.cwd, stringFlag(parsed, "config"));
    const { config } = loaded;
    store = openStore(loaded, stringFlag(parsed, "store"), io.cwd);
    const directory = await runDirectoryOf(target, io.cwd);
    result = await rescore(store, result.run.id, config.spec, {
      dataset: config.dataset,
      extractors: experimentsOf(config),
      ...(directory === undefined ? {} : { source: runDirectory(directory) }),
      ...(config.metrics === undefined ? {} : { metrics: config.metrics }),
      ...(config.slices === undefined ? {} : { slices: config.slices }),
      ...(config.sections === undefined ? {} : { sections: config.sections }),
      ...(config.gate === undefined ? {} : { gate: config.gate }),
      ...(config.enrich === undefined ? {} : { enrich: config.enrich }),
    });
    if (!common.quiet) io.diagnostic(`${style.dim("→")} re-scored ${target} as run ${result.run.id}\n`);
  }
  const names = commaList(listFlag(parsed, "reporter"));
  const reporters = names.length > 0 ? await resolveReporters(names, stringFlag(parsed, "out") ?? "eval-report", io.cwd) : loaded?.config.reporters ?? [];
  await deliver(result, reporters);
  io.write(formatOf(parsed) === "json" ? renderJson(result) : renderScoreboard(result));
  return 0;
}

function experimentOption(value: string | undefined): { readonly experiment?: string | readonly [string, string] } {
  if (value === undefined) return {};
  const [base, candidate, ...rest] = value.split(":");
  if (rest.length > 0 || base === "" || candidate === "") throw new UsageError(`--experiment "${value}" must be <id> or <base>:<candidate>.`);
  return { experiment: candidate === undefined ? value : [base ?? "", candidate] };
}

/** `docture eval compare`: paired comparison of two stored runs. */
export async function compareCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const { store } = await loadConfigAndOpenRunStore(parsed, io);
  const baseline = await readResultArg(positional(parsed, 0, "base"), store, io.cwd);
  const candidate = await readResultArg(positional(parsed, 1, "candidate"), store, io.cwd);
  const test = choiceFlag(parsed, COMPARE_TEST);
  const comparison = compareRuns(baseline, candidate, { ...(test === undefined ? {} : { test }), ...experimentOption(stringFlag(parsed, "experiment")) });
  if (choiceFlag(parsed, COMPARE_FORMAT) === "json") io.write(`${JSON.stringify(comparison, null, 2)}\n`);
  else io.write(renderMarkdown({ ...candidate, comparison }, { title: `Comparison of run ${baseline.run.id} to run ${candidate.run.id}`, sections: [md.comparison()] }));
  return 0;
}

async function withBaseline(result: EvalResult, flag: string | undefined, store: RunStore, fallbackBranch: string | undefined): Promise<EvalResult> {
  if (flag === undefined) return result;
  const { comparison: _stored, ...rest } = result;
  if (flag === "none") return rest;
  const id = flag === "auto"
    ? await resolveBaseline(store, {
      exclude: result.run.id, requireSameDataset: true, datasetFingerprint: result.run.dataset.fingerprint,
      ...(result.run.git === undefined ? {} : { branch: result.run.git.branch }),
      ...(fallbackBranch === undefined ? {} : { fallbackBranch }),
    })
    : flag;
  return id === undefined ? rest : { ...rest, comparison: compareRuns(await store.readResult(id), result) };
}

/** `docture eval gate`: apply the config's gate to a stored run. Exits 1 when it fails. */
export async function gateCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const { loaded, store } = await loadConfigAndOpenRunStore(parsed, io);
  const stored = await readResultArg(positional(parsed, 0, "run"), store, io.cwd);
  const options = loaded?.config.gate;
  const compared = await withBaseline(stored, stringFlag(parsed, "baseline"), store, loaded?.config.fallbackBranch);
  const result: EvalResult = options === undefined ? compared : { ...compared, gate: gate(compared, options) };
  if (formatOf(parsed) === "json") io.write(`${JSON.stringify(result.gate ?? null, null, 2)}\n`);
  else if (result.gate !== undefined) io.write(renderMarkdown(result, { title: `Gate for run ${result.run.id}`, sections: [md.gate()] }));
  return gateExit(result, io, style, common.quiet);
}

function runLine(entry: RunIndexEntry): string {
  const branch = entry.git === undefined ? "" : ` ${entry.git.branch}@${entry.git.sha.slice(0, 7)}${entry.git.dirty ? "*" : ""}`;
  const scores = Object.entries(entry.summary ?? {})
    .map(([experiment, metrics]) => `${experiment} F1 ${metrics["f1"] === null || metrics["f1"] === undefined ? "n/a" : metrics["f1"].toFixed(3)}`);
  return `${entry.id}  ${entry.status.padEnd(11)} ${entry.startedAt}${branch}  ${entry.dataset.id} (${entry.dataset.size})  ${scores.join(", ") || entry.experiments.map((e) => e.id).join(", ")}\n`;
}

/** `docture eval runs`: stored runs, newest first. */
export async function runsCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const { store } = await loadConfigAndOpenRunStore(parsed, io);
  const runs = [...await store.listRuns()].map((entry, order) => ({ entry, order, started: Date.parse(entry.startedAt) || -Infinity }))
    .sort((a, b) => b.started - a.started || b.order - a.order)
    .map(({ entry }) => entry);
  if (formatOf(parsed) === "json") io.write(`${JSON.stringify(runs, null, 2)}\n`);
  else if (runs.length === 0) io.diagnostic("No runs stored yet. Run `docture eval run` first.\n");
  else for (const entry of runs) io.write(runLine(entry));
  return 0;
}

