import { NoObjectGeneratedError } from "ai";
import { ModelOutputError, isAbortError, sumUsage, type Usage, type ValidationIssue } from "../core/index.js";
import { toUsage, type PricingTable } from "./pricing.js";

export function withCompletedUsage(
  error: unknown,
  parts: readonly Partial<Usage>[],
  wallMs: number,
  reportFailureUsage?: (usage: Partial<Usage>) => void,
): unknown {
  if (!(error instanceof ModelOutputError)) {
    if (!isAbortError(error) && parts.some((part) => part !== undefined)) {
      reportFailureUsage?.(sumUsage(parts, wallMs));
    }
    return error;
  }
  return new ModelOutputError(error.message, {
    cause: error.cause,
    usage: sumUsage(parts, wallMs),
    ...(error.rawOutput === undefined ? {} : { rawOutput: error.rawOutput }),
    ...(error.finishReason === undefined ? {} : { finishReason: error.finishReason }),
    ...(error.issues === undefined ? {} : { issues: error.issues }),
  });
}

function issuePath(path: unknown): string | undefined {
  if (path === undefined) return "";
  if (!Array.isArray(path)) return undefined;
  const parts: string[] = [];
  for (const segment of path) {
    const key: unknown = typeof segment === "object" && segment !== null && "key" in segment
      ? segment.key : segment;
    if (typeof key !== "string" && typeof key !== "number" && typeof key !== "symbol") return undefined;
    parts.push(String(key));
  }
  return parts.join(".");
}

function validationIssues(error: unknown): readonly ValidationIssue[] | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const issues = Array.isArray(current) ? current
      : "issues" in current && Array.isArray(current.issues) ? current.issues : undefined;
    if (issues !== undefined) {
      return issues.flatMap((issue: unknown) => {
        if (typeof issue !== "object" || issue === null ||
            !("message" in issue) || typeof issue.message !== "string") return [];
        const path = issuePath("path" in issue ? issue.path : undefined);
        return path === undefined ? [] : [{ path, message: issue.message }];
      });
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

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
  const issues = validationIssues(error);
  return new ModelOutputError(error.message, {
    cause: error,
    ...(usage === undefined ? {} : { usage }),
    ...(error.text === undefined ? {} : { rawOutput: error.text }),
    ...(error.finishReason === undefined ? {} : { finishReason: error.finishReason }),
    ...(issues === undefined ? {} : { issues }),
  });
}
