import type { EvalSpec } from "../../spec/types.js";
import type { Dataset } from "../../case.js";
import type { EvalExtractor } from "../../extractor.js";
import { OutOfScopeError } from "../../errors.js";

export interface MatchExtractionOptions {
  /** Lowest passing F1. Default 1. */
  readonly minF1?: number;
}

/**
 * The matcher's type for Vitest. Opt in once, for example in a `vitest.d.ts`:
 *
 * ```ts
 * import type { ExtractionMatchers } from "@docture/eval/vitest";
 * declare module "vitest" {
 *   interface Matchers<T = any> extends ExtractionMatchers {}
 * }
 * ```
 */
export interface ExtractionMatchers {
  /** Asynchronous: `await expect(actual).toMatchExtraction(expected, spec)`. An assertion that is not awaited never fails the test. */
  toMatchExtraction<T>(expected: T, spec: Pick<EvalSpec<T>, "scoreAsync">, options?: MatchExtractionOptions): Promise<void>;
}

interface MatchResult {
  readonly pass: boolean;
  readonly message: () => string;
}

async function matchExtraction<T>(
  actual: unknown,
  expected: T,
  spec: Pick<EvalSpec<T>, "scoreAsync">,
  options: MatchExtractionOptions,
  isNot: boolean,
): Promise<MatchResult> {
  const threshold = options.minF1 ?? 1;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError("minF1 must be in [0, 1]");
  const score = await spec.scoreAsync(expected, actual);
  const f1 = score.metrics.f1;
  const diff = score.fields
    .filter((field) => field.status !== "match")
    .map((field) => `${field.path}: ${field.status}; expected ${JSON.stringify(field.expected)}, received ${JSON.stringify(field.actual)}`)
    .join("\n");
  return {
    pass: f1 !== null && f1 >= threshold,
    message: () => `Expected extraction F1 ${isNot ? "<" : ">="} ${threshold}; received ${f1 ?? "ungraded"}${diff ? `\n${diff}` : ""}`,
  };
}

/**
 * Score `actual` against `expected` and pass at or above `minF1`; the message lists every differing field.
 * Nothing gradable fails. Asynchronous: register it with `expect.extend` and await every assertion.
 */
export async function toMatchExtraction<T>(
  this: { readonly isNot?: boolean } | void,
  actual: unknown,
  expected: T,
  spec: Pick<EvalSpec<T>, "scoreAsync">,
  options: MatchExtractionOptions = {},
): Promise<MatchResult> {
  return matchExtraction(actual, expected, spec, options, typeof this === "object" && this !== null && this.isNot === true);
}

/**
 * Matchers for `expect.extend(extractionMatchers())`, written without importing Vitest. Add
 * {@link ExtractionMatchers} to Vitest's `Matchers` for types, and await each `toMatchExtraction`.
 */
export function extractionMatchers() {
  return { toMatchExtraction };
}

/** The Vitest functions `describeEval` registers with, typed by what it calls. Pass `{ test: it, beforeAll, afterAll }`. */
export interface DescribeEvalHost {
  readonly test: (name: string, run: (context: { skip(note?: string): never }) => Promise<void>) => unknown;
  readonly beforeAll: (run: () => Promise<void>) => unknown;
  readonly afterAll: (run: () => Promise<void>) => unknown;
}

/**
 * Register one test per dataset case. The processor's `preflight` runs once in `beforeAll` and `dispose`
 * once in `afterAll`. A case whose processor throws `OutOfScopeError` is skipped; a case below `minF1`
 * fails with the differing fields.
 */
export async function describeEval<T, Raw>(
  dataset: Dataset<T>,
  spec: Pick<EvalSpec<T>, "scoreAsync">,
  processor: EvalExtractor<Raw, T>,
  options: DescribeEvalHost & MatchExtractionOptions,
) {
  const controller = new AbortController();
  options.beforeAll(async () => {
    await processor.preflight?.({ signal: controller.signal });
  });
  options.afterAll(async () => {
    controller.abort();
    await processor.dispose?.();
  });
  for (const item of await dataset.cases()) {
    options.test(item.id, async (context) => {
      let output;
      try {
        output = await processor.extract(item, { signal: controller.signal, epoch: 0, experiment: processor.id });
      } catch (error) {
        if (error instanceof OutOfScopeError) context.skip(error.reason);
        throw error;
      }
      const result = await matchExtraction(
        processor.project ? processor.project(output.raw) : output.raw,
        item.expected,
        spec,
        options,
        false,
      );
      if (!result.pass) throw new Error(result.message());
    });
  }
}
