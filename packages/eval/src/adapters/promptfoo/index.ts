import type { EvalSpec } from "../../spec/types.js";

function parsed(output: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  if (typeof output !== "string") return { ok: true, value: output };
  try {
    return { ok: true, value: JSON.parse(output) };
  } catch (error) {
    return { ok: false, reason: `Output is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Create a promptfoo JavaScript assertion; context.vars.expected holds the ground truth. String output that is not JSON fails with score 0. */
export function extractionAssertion<T>(spec: Pick<EvalSpec<T>, "scoreAsync">, options: { readonly threshold?: number } = {}) {
  const threshold = options.threshold ?? 0.95;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("threshold must be in [0, 1]");
  return async (output: unknown, context: { readonly vars: { readonly expected: T } }) => {
    const actual = parsed(output);
    if (!actual.ok) return { pass: false, score: 0, reason: actual.reason };
    const f1 = (await spec.scoreAsync(context.vars.expected, actual.value)).metrics.f1;
    return { pass: f1 !== null && f1 >= threshold, score: f1 ?? 0, reason: `Extraction F1 ${f1 ?? "ungraded"}; required ${threshold}` };
  };
}
