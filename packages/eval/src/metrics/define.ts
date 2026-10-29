import type { MetricDefinition } from "./types.js";

const DIRECTIONS = new Set(["higher", "lower"]);
const FORMATS = new Set(["ratio", "usd", "ms", "count", "number"]);

/**
 * Declare a custom metric. `aggregate` turns an experiment's rows into one value;
 * `perCase`, when given, lets run comparison test the change for significance.
 *
 * @example
 * ```ts
 * const pages = defineMetric({
 *   id: "pages", label: "Pages", direction: "lower", format: "count",
 *   perCase: (row) => row.usage?.pages ?? null,
 *   aggregate: (rows) => rows.reduce((sum, row) => sum + (row.usage?.pages ?? 0), 0),
 * });
 * ```
 */
export function defineMetric(metric: MetricDefinition): MetricDefinition {
  if (!/^[A-Za-z][\w.-]*$/u.test(metric.id)) throw new RangeError(`defineMetric: id "${metric.id}" must start with a letter and use letters, digits, ".", "_" or "-".`);
  if (!DIRECTIONS.has(metric.direction)) throw new RangeError(`defineMetric: direction must be "higher" or "lower", got ${String(metric.direction)}.`);
  if (!FORMATS.has(metric.format)) throw new RangeError(`defineMetric: format must be one of ${[...FORMATS].join(", ")}, got ${String(metric.format)}.`);
  if (typeof metric.aggregate !== "function") throw new RangeError("defineMetric: aggregate must be a function.");
  return metric;
}
