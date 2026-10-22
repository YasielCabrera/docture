import { NoObjectGeneratedError } from "ai";
import { ModelOutputError, sumUsage, type Usage } from "@docture/core";
import { toUsage, type PricingTable } from "./pricing.js";

export function modelOutputError(error: unknown, context: {
  readonly modelId: string;
  readonly pricing: PricingTable | undefined;
  readonly wallMs: number;
  readonly completed?: readonly Partial<Usage>[];
}): unknown {
  if (!NoObjectGeneratedError.isInstance(error)) return error;
  const current = error.usage === undefined
    ? undefined
    : toUsage(error.usage, context.wallMs, context.modelId, context.pricing);
  const parts = [...(context.completed ?? []), current];
  const usage = parts.some((part) => part !== undefined)
    ? sumUsage(parts, context.wallMs)
    : undefined;
  return new ModelOutputError(error.message, {
    cause: error,
    ...(usage === undefined ? {} : { usage }),
  });
}
