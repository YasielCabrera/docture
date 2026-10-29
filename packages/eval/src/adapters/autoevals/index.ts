import type { EvalSpec } from "../../spec/types.js";

/** Create an autoevals scorer returning its name, score and metadata shape. */
export function ExtractionF1<T>(spec: Pick<EvalSpec<T>, "scoreAsync">) {
  return async ({ output, expected }: { readonly output: unknown; readonly expected: T }) => {
    const score = await spec.scoreAsync(expected, output);
    return { name: "ExtractionF1", score: score.metrics.f1 ?? 0, metadata: { counts: score.counts, ungraded: score.metrics.f1 === null } };
  };
}
