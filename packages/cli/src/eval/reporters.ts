import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { messageOf } from "docture";
import type { EvalResult, Reporter } from "@docture/eval";
import type { ExitCode } from "../cli/errors.js";
import type { Io, Style } from "../cli/io.js";
import { UsageError } from "../cli/errors.js";
import { loadExport } from "../load-module.js";

const BUILT_IN: Readonly<Record<string, "scoreboard-always-prints" | ((out: string) => Promise<Reporter>)>> = {
  terminal: "scoreboard-always-prints",
  html: async (out) => (await import("@docture/eval/reporters/html")).htmlReporter({ out: join(out, "report.html") }),
  md: async (out) => (await import("@docture/eval/reporters/markdown")).markdownReporter({ out: join(out, "report.md") }),
  markdown: async (out) => (await import("@docture/eval/reporters/markdown")).markdownReporter({ out: join(out, "report.md") }),
  json: async (out) => (await import("@docture/eval/reporters/json")).jsonReporter({ out: join(out, "result.json") }),
  csv: async (out) => (await import("@docture/eval/reporters/csv")).csvReporter({ out: join(out, "cases.csv") }),
  junit: async (out) => (await import("@docture/eval/reporters/junit")).junitReporter({ out: join(out, "junit.xml") }),
};

const isModulePath = (name: string): boolean => /^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(name) || /\.[cm]?[jt]s$/.test(name);

async function moduleReporter(specifier: string, out: string, cwd: string): Promise<Reporter> {
  const loaded = await loadExport<unknown>(specifier, { kind: "reporter", cwd, names: ["reporter"] });
  const value = loaded.value;
  if (typeof value === "object" && value !== null && "onResult" in value && typeof value.onResult === "function") return value as Reporter;
  if (typeof value !== "function") {
    throw new UsageError(
      `The reporter "${loaded.from}" exports neither a reporter nor a render function.`,
      "Export defineReporter({ id, onResult }) or a function (result) => string.",
    );
  }
  const render = value as (result: EvalResult) => unknown;
  const module = (await import(pathToFileURL(loaded.from).href)) as { fileName?: unknown };
  const fileName = typeof module.fileName === "string" ? module.fileName : `${basename(loaded.from, extname(loaded.from))}.txt`;
  const { templateReporter } = await import("@docture/eval/reporters/template");
  return templateReporter({
    id: basename(loaded.from),
    out: join(out, fileName),
    render: (result) => {
      const text = render(result);
      if (typeof text !== "string") throw new TypeError(`Reporter ${loaded.from} returned ${typeof text}, not a string.`);
      return text;
    },
  });
}

/** Turn `--reporter` names into reporters writing under `out`. Unknown names fail before anything runs. */
export async function resolveReporters(names: readonly string[], out: string, cwd: string): Promise<Reporter[]> {
  const directory = resolve(cwd, out);
  const unknown = names.filter((name) => !(name in BUILT_IN) && !isModulePath(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown reporter ${unknown.join(", ")}.`,
      `Use ${Object.keys(BUILT_IN).join(", ")}, or a module path such as ./reporter.ts.`,
    );
  }
  const reporters: Reporter[] = [];
  for (const name of names) {
    const builtin = BUILT_IN[name];
    if (builtin === "scoreboard-always-prints") continue;
    const reporter = builtin === undefined ? await moduleReporter(name, directory, cwd) : await builtin(directory);
    if (reporter !== undefined) reporters.push(reporter);
  }
  return reporters;
}

/** Hand a finished result to reporters, as a run would. A failing reporter fails the command. */
export async function deliver(result: EvalResult, reporters: readonly Reporter[]): Promise<void> {
  for (const reporter of reporters) await reporter.onResult(result);
}

/** Reporters wrapped to remember their failures, which the runner turns into warnings and the command into exit 1. */
export interface TrackedReporters {
  readonly reporters: readonly Reporter[];
  /** Print each distinct failure to stderr, even under `--quiet`, and return 1 when any reporter failed. */
  report(io: Io, style: Style): ExitCode;
}

/** Wrap reporters so a failure still reaches the runner, which saves the result, and is also remembered. */
export function trackReporters(reporters: readonly Reporter[]): TrackedReporters {
  const failures = new Set<string>();
  const wrap = (reporter: Reporter): Reporter => {
    const guard = async (hook: () => void | Promise<void>): Promise<void> => {
      try {
        await hook();
      } catch (error) {
        failures.add(`Reporter ${reporter.id} failed: ${messageOf(error)}`);
        throw error;
      }
    };
    return {
      id: reporter.id,
      ...(reporter.onRunStart === undefined ? {} : { onRunStart: (run) => guard(() => reporter.onRunStart?.(run)) }),
      ...(reporter.onCase === undefined ? {} : { onCase: (row, progress) => guard(() => reporter.onCase?.(row, progress)) }),
      onResult: (result) => guard(() => reporter.onResult(result)),
    };
  };
  return {
    reporters: reporters.map(wrap),
    report(io, style) {
      for (const failure of failures) io.diagnostic(`${style.red("✗")} ${failure}\n`);
      return failures.size > 0 ? 1 : 0;
    },
  };
}
