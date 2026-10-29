import type { EvalSpec } from "../../spec/types.js";

/** Create an Evalite scorer with its structural name/scorer contract. Ungraded values score zero. */
export function extractionScorer<T>(
  spec: Pick<EvalSpec<T>, "scoreAsync">,
  options: { readonly metric?: "f1" | "precision" | "recall" | "anls" } = {},
) {
  const metric = options.metric ?? "f1";
  return {
    name: `Extraction ${metric}`,
    scorer: async ({ output, expected }: { output: unknown; expected: T }) =>
      (await spec.scoreAsync(expected, output)).metrics[metric] ?? 0,
  };
}
