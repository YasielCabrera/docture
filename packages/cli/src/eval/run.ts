import { dirname } from "node:path";
import type { CaseResult, Reporter } from "@docture/eval";
import { gitInfo } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { renderJson } from "@docture/eval/reporters/json";
import { renderScoreboard, terminalReporter } from "@docture/eval/reporters/terminal";
import { boolFlag, choiceFlag, commaList, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { EVAL_CONFIG_FLAGS, EVAL_QUICK_FLAGS, OUTPUT_FORMAT } from "../cli/specs.js";
import { commonOptions } from "../options.js";
import { toNdjson } from "../output.js";
import { experimentsOf, gateExit, loadEvalConfig, openStore, selectExperiments, valueAt } from "./config.js";
import { resolveReporters, trackReporters } from "./reporters.js";

function rejectFlags(parsed: Parsed, names: readonly string[], why: string, hint: string): void {
  const given = names.filter((name) => parsed.values[name] !== undefined);
  if (given.length > 0) throw new UsageError(`${given.map((name) => `--${name}`).join(", ")} ${why}`, hint);
}

function progressReporter(io: Io): Reporter {
  const terminal = terminalReporter({ stream: { write: (chunk: string) => io.diagnostic(chunk) }, live: false });
  return {
    id: "progress",
    ...(terminal.onRunStart === undefined ? {} : { onRunStart: terminal.onRunStart.bind(terminal) }),
    ...(terminal.onCase === undefined ? {} : { onCase: terminal.onCase.bind(terminal) }),
    onResult() {},
  };
}

/** `docture eval run`: quick mode with files, else the evaluation in docture.eval.ts. */
export async function runCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  if (parsed.positionals.length > 0) {
    rejectFlags(parsed, EVAL_CONFIG_FLAGS, "need docture.eval.ts, not files.", "Drop the files to run docture.eval.ts, or drop these flags for quick mode.");
    return (await import("./quick.js")).quickCommand(parsed, io, signal);
  }
  rejectFlags(parsed, EVAL_QUICK_FLAGS, "work only in quick mode, with files.", "Pass the documents to score, or configure these in docture.eval.ts.");

  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const loaded = await loadEvalConfig(io.cwd, stringFlag(parsed, "config"));
  const { config } = loaded;
  const experiments = selectExperiments(experimentsOf(config), commaList(listFlag(parsed, "experiment")));
  const size = numberFlag(parsed, "sample", { min: 0, integer: true });
  const strata = stringFlag(parsed, "strata");
  const seed = stringFlag(parsed, "seed");
  if (size === undefined && (strata !== undefined || seed !== undefined)) throw new UsageError("--strata and --seed need --sample <n>.");
  const ids = commaList(listFlag(parsed, "cases"));
  const baselineFlag = stringFlag(parsed, "baseline");
  const baseline = baselineFlag === undefined ? config.baseline : baselineFlag === "none" ? false : baselineFlag;
  const reporterNames = commaList(listFlag(parsed, "reporter"));
  const reporters = trackReporters(reporterNames.length > 0
    ? await resolveReporters(reporterNames, stringFlag(parsed, "out") ?? "eval-report", io.cwd)
    : config.reporters ?? []);
  const store = openStore(loaded, stringFlag(parsed, "store"), io.cwd);
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true }) ?? config.concurrency;
  const epochs = numberFlag(parsed, "epochs", { min: 1, integer: true }) ?? config.epochs;
  const resume = stringFlag(parsed, "resume");
  const git = await gitInfo(dirname(loaded.path));
  const rows: Reporter[] = format === "ndjson" ? [{ id: "ndjson", onCase: (row: CaseResult) => io.write(toNdjson(row)), onResult() {} }] : [];

  const result = await runEval({
    dataset: config.dataset,
    spec: config.spec,
    experiments,
    store,
    signal,
    reporters: [...(common.quiet ? [] : [progressReporter(io)]), ...rows, ...reporters.reporters],
    ...(ids.length > 0 || size !== undefined ? {
      select: {
        ...(ids.length > 0 ? { ids } : {}),
        ...(size === undefined ? {} : {
          sample: { size, ...(strata === undefined ? {} : { strata: (item: unknown) => valueAt(item, strata) }), ...(seed === undefined ? {} : { seed }) },
        }),
      },
    } : {}),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(epochs === undefined ? {} : { epochs }),
    ...(resume === undefined ? {} : { resume }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(config.fallbackBranch === undefined ? {} : { fallbackBranch: config.fallbackBranch }),
    ...(git === undefined ? {} : { git }),
    ...(config.metrics === undefined ? {} : { metrics: config.metrics }),
    ...(config.slices === undefined ? {} : { slices: config.slices }),
    ...(config.sections === undefined ? {} : { sections: config.sections }),
    ...(config.gate === undefined || boolFlag(parsed, "no-gate") ? {} : { gate: config.gate }),
    ...(config.enrich === undefined ? {} : { enrich: config.enrich }),
  });

  if (format === "text") io.write(renderScoreboard(result));
  if (format === "json") io.write(renderJson(result));
  if (!common.quiet) io.diagnostic(`${style.dim("→")} run ${result.run.id} ${result.run.status}\n`);
  for (const warning of common.quiet ? [] : result.warnings) io.diagnostic(`${style.yellow("!")} ${warning}\n`);
  const verdict = gateExit(result, io, style, common.quiet);
  const delivered = reporters.report(io, style);
  return result.run.status === "complete" && delivered === 0 ? verdict : 1;
}
