import type { EvalResult } from "../../result/types.js";
import { cellText, defaultColumns } from "../shared/columns.js";
import { diffLines, isFailure } from "../shared/diffs.js";
import { escapeHtml, escapeMarkdown, escapeXml } from "../shared/escape.js";
import { formatCount, formatDelta, formatMetric, formatMs, formatNumber, formatPercent, formatUsd, formatValue } from "../shared/format.js";
import {
  calibrationTables,
  comparisonTables,
  gateTable,
  groundingTables,
  metricInfo,
  overviewTable,
  pathTables,
  segmentTables,
  sliceTables,
} from "../shared/views.js";

/** Formatters, escapes and the shared summary views, for a render function that writes any format. */
export function templateHelpers() {
  return {
    percent: formatPercent,
    usd: formatUsd,
    ms: formatMs,
    count: formatCount,
    number: formatNumber,
    metric: formatMetric,
    delta: formatDelta,
    value: formatValue,
    escapeHtml,
    escapeMarkdown,
    escapeXml,
    columns: defaultColumns,
    cellText,
    diffLines,
    isFailure,
    metricInfo,
    views: {
      overview: overviewTable,
      segments: segmentTables,
      slices: sliceTables,
      paths: pathTables,
      comparison: comparisonTables,
      calibration: calibrationTables,
      grounding: groundingTables,
      gate: gateTable,
    },
  };
}

/** What a template's render function receives besides the result. */
export type TemplateHelpers = ReturnType<typeof templateHelpers>;

/** A render function for any text format. */
export type TemplateRender = (result: EvalResult, helpers: TemplateHelpers) => string;

/** Render a result through a custom template function. */
export function renderTemplate(result: EvalResult, render: TemplateRender): string {
  return render(result, templateHelpers());
}
