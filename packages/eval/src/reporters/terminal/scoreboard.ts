import type { EvalResult } from "../../result/types.js";
import { defaultColumns, type Column } from "../shared/columns.js";
import { diffLines, isFailure } from "../shared/diffs.js";
import {
  calibrationTables,
  groundingTables,
  comparisonTables,
  experimentsOf,
  gateTable,
  overviewTable,
  segmentTables,
  sliceTables,
} from "../shared/views.js";
import { caseTable, escapeTerminal, textTable } from "./text.js";

export interface ScoreboardOptions {
  /** Line width for case lines. Default 100. */
  readonly width?: number;
  readonly columns?: readonly Column[];
  /** Failing cases listed with their diffs. Default 10. */
  readonly failures?: number;
  /** Diff lines shown per failing case. Default 5. */
  readonly diffLines?: number;
}

function runLine(result: EvalResult): string {
  const { run } = result;
  const git = run.git === undefined ? "" : `, ${run.git.branch}@${run.git.sha}${run.git.dirty ? " (dirty)" : ""}`;
  return `Run ${run.id} (${run.status === "aborted" ? "aborted, incomplete" : run.status}), dataset ${run.dataset.id}: ${run.dataset.size} cases, ${run.epochs} epoch${run.epochs === 1 ? "" : "s"}${git}`;
}

function columnRenderedAboveDiffs(column: Column): boolean {
  return column.id !== "message";
}

function failureBlock(
  result: EvalResult,
  options: Required<Omit<ScoreboardOptions, "columns">> & { readonly columns: readonly Column[] },
): string | undefined {
  const failing = result.cases.filter(isFailure);
  if (failing.length === 0) return undefined;
  const counts = experimentsOf(result).map((experiment) => {
    const rows = result.cases.filter((row) => row.experiment === experiment);
    return `${escapeTerminal(experiment)} ${rows.filter(isFailure).length} of ${rows.length}`;
  });
  const shown = failing.slice(0, options.failures);
  const table = caseTable(shown, options.columns.filter(columnRenderedAboveDiffs), options.width - 2);
  const lines = [`Failures: ${counts.join(", ")}`, `  ${table.header}`];
  shown.forEach((row, index) => {
    lines.push(`  ${table.lines[index] ?? ""}`);
    const diffs = diffLines(row);
    for (const diff of diffs.slice(0, options.diffLines)) lines.push(`      ${escapeTerminal(diff)}`);
    if (diffs.length > options.diffLines) lines.push(`      ${diffs.length - options.diffLines} more`);
  });
  if (failing.length > options.failures) lines.push(`  ${failing.length - options.failures} more failing cases`);
  return lines.join("\n");
}

/** The final scoreboard as plain text: overall metrics, segments, slices, failures, comparison verdicts, gate and warnings. */
export function renderScoreboard(result: EvalResult, options: ScoreboardOptions = {}): string {
  const resolved = {
    width: options.width ?? 100,
    columns: options.columns ?? defaultColumns(),
    failures: options.failures ?? 10,
    diffLines: options.diffLines ?? 5,
  };
  const gate = gateTable(result);
  const blocks = [
    escapeTerminal(runLine(result)),
    textTable(overviewTable(result)),
    ...segmentTables(result).map(textTable),
    ...sliceTables(result).map(textTable),
    failureBlock(result, resolved),
    ...comparisonTables(result).map(textTable),
    ...calibrationTables(result).map(textTable),
    ...groundingTables(result).map(textTable),
    gate === undefined ? undefined : textTable(gate),
    result.warnings.length === 0 ? undefined : ["Warnings", ...result.warnings.map((warning) => `  ${escapeTerminal(warning)}`)].join("\n"),
  ];
  return `${blocks.filter((block) => block !== undefined).join("\n\n")}\n`;
}
