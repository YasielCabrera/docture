import type { CaseResult, EvalResult } from "../../result/types.js";
import { diffLines, isFailure } from "../shared/diffs.js";
import { escapeXml } from "../shared/escape.js";
import { formatPercent } from "../shared/format.js";
import { experimentsOf } from "../shared/views.js";

export interface JunitOptions {
  /** A scored case fails when its F1 is below this. Default: it fails unless every leaf and assertion passed. */
  readonly threshold?: number;
}

function attributes(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`).join("");
}

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

function caseF1(row: CaseResult): number | null {
  if (row.outcome !== "scored") return null;
  return row.values?.["f1"] ?? row.score.metrics.f1;
}

/** Reject a threshold that is not a finite number in [0, 1]. */
export function checkThreshold(threshold: number | undefined): void {
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    throw new TypeError("threshold must be a finite number in [0, 1].");
  }
}

function failed(row: CaseResult, threshold: number | undefined): boolean {
  if (row.outcome !== "scored") return false;
  if (threshold === undefined) return isFailure(row);
  const f1 = caseF1(row);
  return f1 === null || f1 < threshold;
}

function failureMessage(row: CaseResult): string {
  if (row.outcome !== "scored") return "";
  if (caseF1(row) === null) return "F1 n/a: nothing gradable; threshold cannot be met.";
  const failedAssertions = row.score.assertions.filter((assertion) => assertion.status === "fail").length;
  const problems = [
    ...(["mismatch", "omission", "hallucination"] as const).filter((status) => row.score.counts[status] > 0).map((status) => `${row.score.counts[status]} ${status}`),
    ...(failedAssertions > 0 ? [`${failedAssertions} failed assertion${failedAssertions === 1 ? "" : "s"}`] : []),
  ];
  return `F1 ${formatPercent(caseF1(row))}${problems.length > 0 ? `: ${problems.join(", ")}` : ""}`;
}

function testcase(row: CaseResult, epochs: number, threshold: number | undefined): string {
  const name = epochs > 1 ? `${row.caseId} [epoch ${row.epoch}]` : row.caseId;
  const open = `    <testcase${attributes({ classname: row.experiment, name, time: seconds(row.ms) })}`;
  if (row.outcome === "skipped") return `${open}>\n      <skipped${attributes({ message: row.reason })}/>\n    </testcase>`;
  if (row.outcome === "errored") {
    const body = diffLines(row).join("\n");
    return `${open}>\n      <error${attributes({ message: row.error.message, type: row.error.name })}>${escapeXml(body)}</error>\n    </testcase>`;
  }
  if (!failed(row, threshold)) return `${open}/>`;
  return `${open}>\n      <failure${attributes({ message: failureMessage(row), type: "mismatch" })}>${escapeXml(diffLines(row).join("\n"))}</failure>\n    </testcase>`;
}

interface Totals {
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  readonly time: number;
}

function suite(name: string, totals: Totals, timestamp: string, body: readonly string[]): string {
  const open = `  <testsuite${attributes({ name, tests: totals.tests, failures: totals.failures, errors: totals.errors, skipped: totals.skipped, time: seconds(totals.time), timestamp })}`;
  return body.length === 0 ? `${open}/>` : `${open}>\n${body.join("\n")}\n  </testsuite>`;
}

/** The result as JUnit XML: one suite per experiment, one test case per case and epoch, and the gate checks as their own suite. */
export function renderJunit(result: EvalResult, options: JunitOptions = {}): string {
  checkThreshold(options.threshold);
  const timestamp = result.run.startedAt;
  const suites: { readonly totals: Totals; readonly xml: string }[] = experimentsOf(result).map((experiment) => {
    const rows = result.cases.filter((row) => row.experiment === experiment);
    const totals = {
      tests: rows.length,
      failures: rows.filter((row) => failed(row, options.threshold)).length,
      errors: rows.filter((row) => row.outcome === "errored").length,
      skipped: rows.filter((row) => row.outcome === "skipped").length,
      time: rows.reduce((sum, row) => sum + row.ms, 0),
    };
    return { totals, xml: suite(experiment, totals, timestamp, rows.map((row) => testcase(row, result.run.epochs, options.threshold))) };
  });
  if (result.gate !== undefined) {
    const checks = result.gate.checks;
    const totals = {
      tests: checks.length,
      failures: checks.filter((check) => check.status === "fail").length,
      errors: 0,
      skipped: checks.filter((check) => check.status === "skipped").length,
      time: 0,
    };
    const body = checks.map((check) => {
      const open = `    <testcase${attributes({ classname: "gate", name: check.experiment === "" ? check.target : `${check.experiment}: ${check.target}`, time: seconds(0) })}`;
      if (check.status === "pass") return `${open}/>`;
      const element = check.status === "fail" ? "failure" : "skipped";
      return `${open}>\n      <${element}${attributes({ message: check.kind === "run" && check.status === "fail" ? `incomplete run: ${check.message}` : check.message })}/>\n    </testcase>`;
    });
    suites.push({ totals, xml: suite("gate", totals, timestamp, body) });
  }
  const sum = (key: keyof Totals): number => suites.reduce((total, entry) => total + entry.totals[key], 0);
  const root = attributes({ name: `eval ${result.run.id}`, tests: sum("tests"), failures: sum("failures"), errors: sum("errors"), skipped: sum("skipped"), time: seconds(sum("time")) });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites${root}>\n${suites.map((entry) => entry.xml).join("\n")}\n</testsuites>\n`;
}
