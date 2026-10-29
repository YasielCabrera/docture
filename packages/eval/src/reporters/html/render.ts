import type { MetricFormat } from "../../metrics/types.js";
import type { CaseResult, EvalResult } from "../../result/types.js";
import { cellText, defaultColumns, isNumericColumn, type Column } from "../shared/columns.js";
import { isFailure } from "../shared/diffs.js";
import { escapeHtml } from "../shared/escape.js";
import { formatCount, formatMetric, formatNumber, formatPercent } from "../shared/format.js";
import {
  calibrationTables,
  comparisonTables,
  experimentsOf,
  gateTable,
  groundingTables,
  headlineMetrics,
  overviewTable,
  pathTables,
  segmentTables,
  sliceTables,
  type TableView,
} from "../shared/views.js";
import { CLIENT_SCRIPT, CLIENT_STYLE } from "./client.generated.js";
import { HTML_IDS, type BarData, type HtmlView, type PanelData, type SectionData, type TileData, type Tone } from "./view.js";

/** A headline number for {@link panel.tiles}. A number is formatted with `format`, default `number`. */
export interface Tile {
  readonly label: string;
  readonly value: number | string | null;
  readonly format?: MetricFormat;
  readonly detail?: string;
  readonly tone?: Tone;
}

/** One bar for {@link panel.bars}. */
export interface Bar {
  readonly label: string;
  readonly value: number | null;
  readonly format?: MetricFormat;
  readonly tone?: Tone;
}

/** A panel computed from the result on the server. The client renders the data, never markup. */
export type HtmlPanel = (result: EvalResult) => PanelData;

/** Score colors: green at 99.5%, accent at 90%, amber at 60%, red below. */
export function scoreTone(value: number | null): Tone {
  if (value === null) return "neutral";
  if (value >= 0.995) return "good";
  if (value >= 0.9) return "fair";
  if (value >= 0.6) return "warn";
  return "bad";
}

function tileText(value: number | string | null, format: MetricFormat): string {
  return typeof value === "string" ? value : formatMetric(value, format);
}

/** Data panels for the HTML report. */
export const panel = {
  /** Headline numbers. */
  tiles: (title: string, compute: (result: EvalResult) => readonly Tile[]): HtmlPanel => (result) => ({
    kind: "tiles",
    title,
    items: compute(result).map((tile): TileData => ({
      label: tile.label,
      text: tileText(tile.value, tile.format ?? "number"),
      tone: tile.tone ?? "neutral",
      ...(tile.detail === undefined ? {} : { detail: tile.detail }),
    })),
  }),
  /** Horizontal bars. `max` sets the full length; default 1, which suits ratios. */
  bars: (title: string, compute: (result: EvalResult) => readonly Bar[], options: { readonly max?: number } = {}): HtmlPanel => (result) => ({
    kind: "bars",
    title,
    max: options.max ?? 1,
    items: compute(result).map((bar): BarData => ({
      label: bar.label,
      value: bar.value,
      text: formatMetric(bar.value, bar.format ?? "ratio"),
      tone: bar.tone ?? (bar.format === undefined || bar.format === "ratio" ? scoreTone(bar.value) : "neutral"),
    })),
  }),
  /** A table of text cells. */
  table: (title: string, compute: (result: EvalResult) => { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly numeric?: readonly boolean[] }): HtmlPanel => (result) => {
    const data = compute(result);
    return { kind: "table", title, columns: data.columns, rows: data.rows, numeric: data.numeric ?? data.columns.map(() => false), notes: [] };
  },
};

/** The pieces of the page, for a `template` that replaces the shell. Every part is safe to place as is. */
export interface HtmlParts {
  /**
   * The Content-Security-Policy `<meta>` element that blocks every network load. A template must place it in the
   * page's head, before any `<style>`, `<script>` or `<body>`; `renderHtml` rejects a template page without it.
   */
  readonly csp: string;
  /** Escaped page title. */
  readonly title: string;
  /** CSS for a `<style>` element, theme included. */
  readonly css: string;
  /** The client for a `<script>` element. */
  readonly script: string;
  /** The `<script type="application/json">` elements holding the result and the view. */
  readonly data: string;
  /** The default body: the in-page copy `<template>` and the element the client renders into. */
  readonly body: string;
}

/** Colors, a logo and extra CSS. */
export interface HtmlTheme {
  /** A CSS color, such as `#4f46e5`. */
  readonly accent?: string;
  /** A `data:image/...` URL. The report references nothing on the network. */
  readonly logo?: string;
  /** Appended after the built-in styles. */
  readonly css?: string;
}

export interface HtmlOptions {
  /** Default `Eval run <run id>`. */
  readonly title?: string;
  readonly theme?: HtmlTheme;
  /** Columns of the documents table. Default: the shared default columns. */
  readonly columns?: readonly Column[];
  /** Panels shown after the overview. */
  readonly panels?: readonly HtmlPanel[];
  /**
   * `all` embeds every leaf and both documents of every case. `failures` keeps only leaves that did not match
   * and drops whole documents, which keeps large corpora small. Default `failures`.
   */
  readonly detail?: "all" | "failures";
  /** Replace the page shell. The page must include `parts.csp` in its head. */
  readonly template?: (parts: HtmlParts) => string;
}

/** JSON for a `<script type="application/json">` element: `<` and line separators are escaped so the data cannot end the element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function withDetail(result: EvalResult, detail: "all" | "failures"): EvalResult {
  if (detail === "all") return result;
  const trim = (row: CaseResult): CaseResult => {
    if (row.outcome === "skipped") return row;
    if (row.outcome === "errored") return { ...row, expected: null };
    return { ...row, expected: null, actual: null, score: { ...row.score, fields: row.score.fields.filter((field) => field.status !== "match") } };
  };
  return { ...result, cases: result.cases.map(trim) };
}

const table = (view: TableView): PanelData => ({ kind: "table", ...view });

function overviewSection(result: EvalResult): SectionData {
  const metrics = headlineMetrics(result).slice(0, 8);
  const panels: PanelData[] = experimentsOf(result).flatMap((experiment): PanelData[] => {
    const summary = result.summary[experiment]!;
    const label = experimentsOf(result).length > 1 ? `: ${experiment}` : "";
    const tiles: TileData[] = [
      { label: "Cases", text: formatCount(summary.cases.total), detail: `${summary.cases.scored} scored, ${summary.cases.errored} errored, ${summary.cases.skipped} skipped`, tone: summary.cases.errored > 0 ? "warn" : "neutral" },
      ...metrics.map((metric): TileData => {
        const value = summary.overall[metric.id] ?? null;
        return { label: metric.label, text: formatMetric(value, metric.format), tone: metric.format === "ratio" && metric.direction === "higher" ? scoreTone(value) : "neutral" };
      }),
    ];
    const segments = Object.entries(summary.segments).map(([name, segment]): BarData => {
      const f1 = segment.metrics.f1 ?? null;
      return { label: name, value: f1, text: formatPercent(f1), tone: scoreTone(f1) };
    });
    return [
      { kind: "tiles", title: `Headline${label}`, items: tiles },
      ...(segments.length === 0 ? [] : [{ kind: "bars" as const, title: `F1 by segment${label}`, max: 1, items: segments }]),
    ];
  });
  return { id: "overview", title: "Overview", panels: [...panels, table(overviewTable(result)), ...sliceTables(result).map(table), ...segmentTables(result).map(table)] };
}

function calibrationSection(result: EvalResult): SectionData | undefined {
  const calibration = result.calibration;
  if (calibration === undefined) return undefined;
  const panels = Object.entries(calibration.experiments).flatMap(([experiment, summary]): PanelData[] => {
    const label = Object.keys(calibration.experiments).length > 1 ? `: ${experiment}` : "";
    const reliability = summary.overall.bins.filter((bin) => bin.count > 0).map((bin): BarData => {
      const accuracy = bin.correct / bin.count;
      return {
        label: `${formatNumber(bin.lower)} to ${formatNumber(bin.upper)}`,
        value: accuracy,
        text: `${formatPercent(accuracy)} correct, mean confidence ${formatPercent(bin.confidenceSum / bin.count)}, ${formatCount(bin.count)} fields`,
        tone: Math.abs(accuracy - bin.confidenceSum / bin.count) <= 0.05 ? "good" : "warn",
      };
    });
    const coverage: TableView = {
      title: `Risk and coverage${label}`,
      columns: ["Threshold", "Coverage", "Accuracy"],
      numeric: [true, true, true],
      rows: summary.overall.riskCoverage.map((point) => [formatNumber(point.threshold), formatPercent(point.coverage), formatPercent(point.accuracy)]),
      notes: [],
    };
    return [{ kind: "bars", title: `Reliability${label}`, max: 1, items: reliability }, table(coverage)];
  });
  return { id: "calibration", title: "Calibration", panels: [...calibrationTables(result).map(table), ...panels] };
}

function groundingSection(result: EvalResult): SectionData | undefined {
  const grounding = result.grounding;
  if (grounding === undefined) return undefined;
  const tiles = Object.entries(grounding.experiments).map(([experiment, summary]): PanelData => ({
    kind: "tiles",
    title: Object.keys(grounding.experiments).length > 1 ? `Grounded: ${experiment}` : "Grounded",
    items: [
      { label: "Grounded F1", text: formatPercent(summary.overall.groundedF1), tone: scoreTone(summary.overall.groundedF1) },
      { label: "Grounded precision", text: formatPercent(summary.overall.groundedPrecision), tone: scoreTone(summary.overall.groundedPrecision) },
      { label: "Grounded recall", text: formatPercent(summary.overall.groundedRecall), tone: scoreTone(summary.overall.groundedRecall) },
      { label: "Labelled cases", text: formatCount(summary.cases.labelled), detail: `${summary.cases.unlabelled} unlabelled, not scored`, tone: "neutral" },
    ],
  }));
  return { id: "grounding", title: "Grounding", panels: [...tiles, ...groundingTables(result).map(table)] };
}

function gateSection(result: EvalResult): SectionData | undefined {
  const view = gateTable(result);
  if (view === undefined || result.gate === undefined) return undefined;
  const failed = result.gate.checks.filter((check) => check.status === "fail").length;
  return {
    id: "gate",
    title: "Gate",
    panels: [
      { kind: "tiles", title: "", items: [{ label: "Gate", text: result.gate.pass ? "pass" : "fail", detail: `${failed} of ${result.gate.checks.length} checks failed`, tone: result.gate.pass ? "good" : "bad" }] },
      table(view),
    ],
  };
}

function sections(result: EvalResult, panels: readonly HtmlPanel[]): SectionData[] {
  const comparison = comparisonTables(result);
  const paths = pathTables(result, 50);
  const candidates: (SectionData | undefined)[] = [
    overviewSection(result),
    panels.length === 0 ? undefined : { id: "panels", title: "", panels: panels.map((compute) => compute(result)) },
    gateSection(result),
    comparison.length === 0 ? undefined : { id: "comparison", title: "Comparison", panels: comparison.map(table) },
    paths.length === 0 ? undefined : { id: "paths", title: "Paths", panels: paths.map(table) },
    calibrationSection(result),
    groundingSection(result),
    result.warnings.length === 0
      ? undefined
      : { id: "warnings", title: "Warnings", panels: [table({ title: "", columns: ["Warning"], numeric: [false], rows: result.warnings.map((warning) => [warning]), notes: [] })] },
  ];
  return candidates.filter((section): section is SectionData => section !== undefined);
}

function documents(result: EvalResult, columns: readonly Column[]): HtmlView["documents"] {
  return {
    columns: columns.map((column) => ({ id: column.id, header: column.header, numeric: isNumericColumn(column, result.cases) })),
    rows: result.cases.map((row, index) => ({
      index,
      failed: isFailure(row),
      values: columns.map((column) => column.value(row)),
      text: columns.map((column) => cellText(column, row)),
    })),
  };
}

const COLOR = /^[#a-zA-Z0-9(),.%\s-]+$/;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+(;[a-z0-9.+=-]+)*,[a-z0-9+\/=%._~-]*$/i;

const CSS_ESCAPE = /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi;
const decodeCss = (text: string): string => text.replace(/\\(?:\r\n|[\n\r\f])/g, "").replace(CSS_ESCAPE, (_match, hex: string | undefined, char: string | undefined) => hex === undefined ? (char ?? "") : String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)));
const FETCHABLE = /^\s*(?:(?!data:)[a-z][a-z\d+.-]*:|\/\/)/i;
const DATA_URL = /^\s*data:/i;

type CssToken = { readonly kind: "bare" | "string"; readonly text: string };

/** CSS as bare text and string contents, comments dropped and escapes resolved, so a check sees what the browser parses. */
function cssTokens(css: string): CssToken[] {
  const tokens: CssToken[] = [];
  let bare = "";
  const flush = (): void => { if (bare !== "") tokens.push({ kind: "bare", text: decodeCss(bare) }); bare = ""; };
  for (let i = 0; i < css.length;) {
    const char = css[i] ?? "";
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      bare += " ";
    } else if (char === '"' || char === "'") {
      flush();
      let raw = "";
      for (i += 1; i < css.length && css[i] !== char; i += 1) raw += css[i] === "\\" ? `\\${css[++i] ?? ""}` : css[i];
      i += 1;
      tokens.push({ kind: "string", text: decodeCss(raw) });
    } else {
      bare += char;
      i += 1;
    }
  }
  flush();
  return tokens;
}

/**
 * Whether custom CSS loads nothing: no `@import`, every `url()` target a `data:` URL, no string argument of
 * any function (`image-set()`, `src()`, `image()`) with a scheme other than `data:` or a leading `//`, and no
 * unquoted `//` outside a `data:` URL.
 */
function offlineCss(css: string): boolean {
  let depth = 0;
  let previous = "";
  for (const token of cssTokens(css)) {
    if (token.kind === "string") {
      const urlTarget = /url\s*\(\s*$/i.test(previous);
      if (urlTarget ? !DATA_URL.test(token.text) : depth > 0 && FETCHABLE.test(token.text)) return false;
      previous = "";
      continue;
    }
    if (/@import/i.test(token.text)) return false;
    let rest = token.text;
    for (const match of token.text.matchAll(/url\s*\(\s*([^)\s][^)]*)\)/gi)) {
      if (!DATA_URL.test(match[1] ?? "")) return false;
      rest = rest.replace(match[0], "url()");
    }
    if (rest.includes("//")) return false;
    for (const char of rest) depth = Math.max(0, depth + (char === "(" ? 1 : char === ")" ? -1 : 0));
    previous = token.text;
  }
  return true;
}

function themeCss(theme: HtmlTheme): string {
  const problems = [
    theme.css !== undefined && !offlineCss(theme.css) ? "theme.css must not contain @import, non-data url() references or other network URLs." : undefined,
    theme.accent !== undefined && !COLOR.test(theme.accent) ? `theme.accent must be a CSS color, such as #4f46e5; got ${JSON.stringify(theme.accent)}.` : undefined,
    theme.logo !== undefined && !DATA_IMAGE.test(theme.logo) ? "theme.logo must be a data:image URL so the report stays offline." : undefined,
  ].filter((problem) => problem !== undefined);
  if (problems.length > 0) throw new TypeError(problems.join(" "));
  const accent = theme.accent === undefined ? "" : `:root{--accent:${theme.accent}}`;
  return `${accent}${(theme.css ?? "").replace(/<\//g, "<\\/")}`;
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;

const IN_PROGRESS = "This run is still in progress. The file is rewritten as cases finish; reload to see the latest.";

const COPY: readonly (readonly [string, string])[] = [
  ["detail-failures", "This report keeps only the fields that did not match. result.json holds every field and both documents."],
  ["cases", "Cases"],
  ["filter", "Filter cases"],
  ["failures-only", "Failures only"],
  ["shown", "shown"],
  ["no-rows", "No case matches the filter."],
  ["field-diffs", "Fields that did not match"],
  ["row-diffs", "Row alignment"],
  ["assertions", "Failed assertions"],
  ["error", "Error"],
  ["skipped", "Skipped"],
  ["all-matched", "Every field matched."],
  ["path", "Path"],
  ["status", "Status"],
  ["expected", "Expected"],
  ["actual", "Actual"],
  ["hint", "Hint"],
  ["sort", "Sort by this column"],
];

/**
 * The result as one offline HTML file: inline CSS, the prebuilt client, and the result embedded as JSON.
 * The page references nothing on the network and the client never parses markup from the data.
 */
export function renderHtml(result: EvalResult, options: HtmlOptions = {}): string {
  const detail = options.detail ?? "failures";
  const title = options.title ?? `Eval run ${result.run.id}`;
  const theme = options.theme ?? {};
  const css = `${CLIENT_STYLE}${themeCss(theme)}`;
  const view: HtmlView = { title, detail, sections: sections(result, options.panels ?? []), documents: documents(result, options.columns ?? defaultColumns()) };
  const copy = COPY.map(([key, text]) => `<span data-copy="${key}">${escapeHtml(text)}</span>`).join("");
  const logo = theme.logo === undefined ? "" : `<img class="logo" alt="" src="${escapeHtml(theme.logo)}">`;
  const parts: HtmlParts = {
    csp: CSP,
    title: escapeHtml(title),
    css,
    script: CLIENT_SCRIPT,
    data: [
      `<script type="application/json" id="${HTML_IDS.result}">${embedJson(withDetail(result, detail))}</script>`,
      `<script type="application/json" id="${HTML_IDS.view}">${embedJson(view)}</script>`,
    ].join("\n"),
    body: [
      `<template id="${HTML_IDS.copy}">${copy}</template>`,
      `<header class="page">${logo}<h1>${escapeHtml(title)}</h1></header>`,
      result.run.status === "in-progress" ? `<p class="banner" id="${HTML_IDS.banner}">${IN_PROGRESS}</p>` : "",
      `<main id="${HTML_IDS.app}"></main>`,
    ].filter((line) => line !== "").join("\n"),
  };
  if (options.template !== undefined) {
    const page = options.template(parts);
    const at = page.indexOf(CSP);
    if (at === -1 || /<(?:style|script|body)[\s>]/i.test(page.slice(0, at))) {
      throw new TypeError("The HTML template must place parts.csp in the page's head, before any <style>, <script> or <body>.");
    }
    return page;
  }
  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    parts.csp,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${parts.title}</title>`,
    `<style>${parts.css}</style>`,
    "</head>",
    "<body>",
    parts.body,
    parts.data,
    `<script>${parts.script}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
