import type { MetricFormat } from "../../metrics/types.js";
import type { CaseResult, EvalResult } from "../../result/types.js";
import { cellText, defaultColumns, isNumericColumn, type Column } from "../shared/columns.js";
import { assertionFailures, describeRows, fieldDiffs, isFailure, rowDefects } from "../shared/diffs.js";
import { escapeMarkdown } from "../shared/escape.js";
import { formatCount, formatMetric, formatMs, formatPercent, formatUsd } from "../shared/format.js";
import {
  calibrationTables,
  comparisonTables,
  gateTable,
  groundingTables,
  overviewTable,
  pathTables,
  segmentTables,
  sliceTables,
  type TableView,
} from "../shared/views.js";

/** What every Markdown section receives besides the result. */
export interface MarkdownHelpers {
  /** A Markdown table. Cells are escaped; `numeric` right-aligns columns. */
  table(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[], numeric?: readonly boolean[]): string;
  /** A summary view as a `##` heading, a table and its notes. */
  view(view: TableView): string;
  /** Escape text for a table cell or a paragraph. */
  escape(text: string): string;
  percent(value: number | null | undefined): string;
  usd(value: number | null | undefined): string;
  ms(value: number | null | undefined): string;
  count(value: number | null | undefined): string;
  metric(value: number | null | undefined, format: MetricFormat): string;
  /** The columns of per-case tables. */
  readonly columns: readonly Column[];
}

/** One part of a Markdown report. An empty string leaves the section out. */
export type MarkdownSection = (result: EvalResult, helpers: MarkdownHelpers) => string;

export interface MarkdownOptions {
  /** Default `Eval run <run id>`. */
  readonly title?: string;
  /** Default `md.defaultSections`. */
  readonly sections?: readonly MarkdownSection[];
  /** Default `md.defaultColumns`. */
  readonly columns?: readonly Column[];
}

function markdownTable(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[], numeric: readonly boolean[] = []): string {
  const cell = (value: string | number | null): string => escapeMarkdown(value === null ? "" : String(value));
  const line = (cells: readonly (string | number | null)[]): string => `| ${cells.map(cell).join(" | ")} |`;
  const rule = `|${headers.map((_header, index) => (numeric[index] ? " ---: " : " --- ")).join("|")}|`;
  return [line(headers), rule, ...rows.map(line)].join("\n");
}

function helpersFor(columns: readonly Column[]): MarkdownHelpers {
  return {
    table: markdownTable,
    view: (view) => [`## ${escapeMarkdown(view.title)}`, markdownTable(view.columns, view.rows, view.numeric), ...view.notes.map(escapeMarkdown)].join("\n\n"),
    escape: escapeMarkdown,
    percent: formatPercent,
    usd: formatUsd,
    ms: formatMs,
    count: formatCount,
    metric: formatMetric,
    columns,
  };
}

function caseTable(rows: readonly CaseResult[], helpers: MarkdownHelpers): string {
  const numeric = helpers.columns.map((column) => isNumericColumn(column, rows));
  return helpers.table(helpers.columns.map((column) => column.header), rows.map((row) => helpers.columns.map((column) => cellText(column, row))), numeric);
}

function caseDetail(row: CaseResult, helpers: MarkdownHelpers): string {
  const heading = `### ${helpers.escape(row.caseId)} (${helpers.escape(row.experiment)}, epoch ${row.epoch})`;
  if (row.outcome === "errored") return `${heading}\n\n${helpers.escape(`${row.error.name}${row.error.code === undefined ? "" : ` [${row.error.code}]`}: ${row.error.message}`)}`;
  const diffs = fieldDiffs(row);
  const parts = [heading];
  if (diffs.length > 0) {
    parts.push(helpers.table(["Path", "Status", "Expected", "Actual", "Hint"], diffs.map((diff) => [
      diff.path,
      diff.status,
      diff.expected,
      diff.actual,
      [diff.hint, diff.note].filter((part) => part !== undefined).join("; "),
    ])));
  }
  const notes = [...rowDefects(row).map(describeRows), ...assertionFailures(row).map((failure) => `assertion ${failure}`)];
  if (notes.length > 0) parts.push(notes.map((note) => `- ${helpers.escape(note)}`).join("\n"));
  return parts.join("\n\n");
}

const views = (list: readonly TableView[], helpers: MarkdownHelpers): string => list.map(helpers.view).join("\n\n");

function runSummary(result: EvalResult, helpers: MarkdownHelpers): string {
  const { run } = result;
  const lines = [
    `Run ${helpers.escape(run.id)} is ${run.status === "aborted" ? "aborted (incomplete)" : run.status}. Dataset ${helpers.escape(run.dataset.id)} has ${run.dataset.size} cases; ${run.epochs} epoch${run.epochs === 1 ? "" : "s"}.`,
  ];
  if (run.git !== undefined) lines.push(`Git ${helpers.escape(run.git.branch)} at ${helpers.escape(run.git.sha)}${run.git.dirty ? " with uncommitted changes" : ""}.`);
  return lines.join(" ");
}

/** Composable Markdown sections. Each returns a function `(result, helpers) => string`. */
export const md = {
  /** Run line and headline metrics per experiment. */
  overview: (): MarkdownSection => (result, helpers) => {
    const view = overviewTable(result);
    return [`## ${view.title}`, runSummary(result, helpers), helpers.table(view.columns, view.rows, view.numeric)].join("\n\n");
  },
  /** Scores and field counts per segment. */
  segments: (): MarkdownSection => (result, helpers) => views(segmentTables(result), helpers),
  /** Scores per slice value, for one slice name or all of them. */
  slices: (name?: string): MarkdownSection => (result, helpers) => views(sliceTables(result, name), helpers),
  /** Path patterns, worst F1 first. Default limit 20. */
  paths: (options: { readonly limit?: number } = {}): MarkdownSection => (result, helpers) => views(pathTables(result, options.limit ?? 20), helpers),
  /** Metric deltas, significance and changed cases against the baseline. */
  comparison: (): MarkdownSection => (result, helpers) => views(comparisonTables(result), helpers),
  /** Calibration error and auto-accept coverage. */
  calibration: (): MarkdownSection => (result, helpers) => views(calibrationTables(result), helpers),
  /** Grounded precision, recall and F1. */
  grounding: (): MarkdownSection => (result, helpers) => views(groundingTables(result), helpers),
  /** The gate verdict and every check. */
  gate: (): MarkdownSection => (result, helpers) => {
    const view = gateTable(result);
    return view === undefined ? "" : helpers.view(view);
  },
  /** Failing cases as a table, then the field diffs with repair hints of the first `limit`. Default limit 20. */
  failures: (options: { readonly limit?: number } = {}): MarkdownSection => (result, helpers) => {
    const failing = result.cases.filter(isFailure);
    if (failing.length === 0) return "";
    const limit = options.limit ?? 20;
    const shown = failing.slice(0, limit);
    const more = failing.length > shown.length ? [`${failing.length - shown.length} more failing cases not shown.`] : [];
    return [`## Failures`, `${failing.length} of ${result.cases.length} cases failed.`, caseTable(shown, helpers), ...shown.map((row) => caseDetail(row, helpers)), ...more].join("\n\n");
  },
  /** Every case as a table of the report's columns. */
  cases: (): MarkdownSection => (result, helpers) => (result.cases.length === 0 ? "" : `## Cases\n\n${caseTable(result.cases, helpers)}`),
  /** Warnings recorded while building the result. */
  warnings: (): MarkdownSection => (result, helpers) =>
    result.warnings.length === 0 ? "" : `## Warnings\n\n${result.warnings.map((warning) => `- ${helpers.escape(warning)}`).join("\n")}`,
  /** Overview, segments, slices, paths, comparison, calibration, grounding, gate, failures and warnings. */
  get defaultSections(): readonly MarkdownSection[] {
    return [md.overview(), md.segments(), md.slices(), md.paths(), md.comparison(), md.calibration(), md.grounding(), md.gate(), md.failures(), md.warnings()];
  },
  /** The shared default columns. */
  get defaultColumns(): readonly Column[] {
    return defaultColumns();
  },
};

/** The result as a Markdown report built from sections. */
export function renderMarkdown(result: EvalResult, options: MarkdownOptions = {}): string {
  const helpers = helpersFor(options.columns ?? defaultColumns());
  const title = options.title ?? `Eval run ${result.run.id}`;
  const sections = (options.sections ?? md.defaultSections).map((section) => section(result, helpers)).filter((text) => text.trim() !== "");
  return `${[`# ${escapeMarkdown(title)}`, ...sections].join("\n\n")}\n`;
}
