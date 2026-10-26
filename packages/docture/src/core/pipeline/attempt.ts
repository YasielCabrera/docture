import type { Attempt } from "../domain/result.js";
import { ContractViolationError, ModelOutputError, errorCodeOf, messageOf } from "./errors.js";

export function failedAttempt(stage: Attempt["stage"], name: string, ms: number, error: unknown): Attempt {
  const code = errorCodeOf(error);
  const model = error instanceof ModelOutputError ? error : undefined;
  const issues = error instanceof ContractViolationError ? error.issues : model?.issues;
  return {
    stage, strategy: name, status: "failed", ms, error: messageOf(error),
    ...(code === undefined ? {} : { errorCode: code }),
    ...(model?.usage === undefined ? {} : { usage: model.usage }),
    ...(model?.rawOutput === undefined ? {} : { rawOutput: model.rawOutput }),
    ...(model?.finishReason === undefined ? {} : { finishReason: model.finishReason }),
    ...(issues === undefined ? {} : { issues }),
  };
}
