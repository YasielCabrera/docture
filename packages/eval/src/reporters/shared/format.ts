import type { JsonValue } from "../../json.js";
import type { MetricFormat } from "../../metrics/types.js";

/** Shown wherever a value is missing or there was nothing to measure. */
export const NOT_AVAILABLE = "n/a";

/** `0.9333` as `93.3%`. */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : `${(value * 100).toFixed(1)}%`;
}

/** Four decimals under one dollar, two above. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  const sign = value < 0 ? "-" : "";
  const amount = Math.abs(value);
  return `${sign}$${amount.toFixed(amount !== 0 && amount < 1 ? 4 : 2)}`;
}

/** `412 ms` under a second, `1.8 s` above. */
export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return Math.abs(value) < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

/** A whole number with thousands separators, independent of the host locale. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  const rounded = Math.round(value);
  return `${rounded < 0 ? "-" : ""}${String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Up to three decimals, trailing zeros dropped. */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : String(Number(value.toFixed(3)));
}

const FORMATTERS: Readonly<Record<MetricFormat, (value: number | null | undefined) => string>> = {
  ratio: formatPercent,
  usd: formatUsd,
  ms: formatMs,
  count: formatCount,
  number: formatNumber,
};

/** A metric value in its declared format. */
export function formatMetric(value: number | null | undefined, format: MetricFormat): string {
  return FORMATTERS[format](value);
}

/** A change between runs: percentage points for ratios, signed values otherwise. */
export function formatDelta(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  if (format === "ratio") return `${sign}${(Math.abs(value) * 100).toFixed(1)} pp`;
  return `${sign}${formatMetric(Math.abs(value), format)}`;
}

/** A compared value as a reader should see it: strings bare unless blank, `null` spelled out, anything else as JSON. */
export function formatValue(value: JsonValue | undefined): string {
  if (value === undefined) return NOT_AVAILABLE;
  if (typeof value === "string") return value.trim() === "" ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}
