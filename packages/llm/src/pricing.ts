/**
 * Cost accounting.
 *
 * Token counts come from the provider; prices do not. Rather than ship a price
 * table that silently goes stale, this asks the caller for one — and reports
 * `costUsd: undefined` when it has none, which is honest, instead of `0`, which
 * reads like "this was free".
 */

import type { Usage } from "@docture/core";

/** USD per million tokens, the unit every provider quotes. */
export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/** Keyed by model id, e.g. `"gpt-5"` or `"openai/gpt-5"`. */
export type PricingTable = Readonly<Record<string, ModelPricing>>;

export interface RawUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

/**
 * Normalize a provider's usage into ours, costing it if we can.
 *
 * The AI SDK reports every token count as `number | undefined` — a provider that
 * does not say gets `undefined`, not `0`. We collapse to `0` for the counts (a sum
 * of unknowns is not useful) but keep `costUsd` absent unless a price was found.
 */
export function toUsage(
  raw: RawUsage,
  wallMs: number,
  modelId?: string,
  pricing?: PricingTable,
): Partial<Usage> {
  const inputTokens = raw.inputTokens ?? 0;
  const outputTokens = raw.outputTokens ?? 0;
  const totalTokens = raw.totalTokens ?? inputTokens + outputTokens;

  const rate = modelId === undefined ? undefined : lookupPricing(modelId, pricing);
  const costUsd =
    rate === undefined
      ? undefined
      : (inputTokens / 1_000_000) * rate.inputPerMillion +
        (outputTokens / 1_000_000) * rate.outputPerMillion;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    wallMs,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/**
 * Find a price for `modelId`.
 *
 * Tries the id as given, then without a `provider/` prefix — so a table keyed on
 * `"gpt-5"` still prices a gateway model string of `"openai/gpt-5"`.
 */
export function lookupPricing(
  modelId: string,
  pricing: PricingTable | undefined,
): ModelPricing | undefined {
  if (pricing === undefined) return undefined;
  const direct = pricing[modelId];
  if (direct !== undefined) return direct;

  const withoutProvider = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : undefined;
  return withoutProvider === undefined ? undefined : pricing[withoutProvider];
}
