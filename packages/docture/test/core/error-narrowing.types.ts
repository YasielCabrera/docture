import {
  createExtractor, errorCodeOf, isDoctureError,
  type Attempt, type DoctureError, type DoctureErrorCode, type SafeConversion,
} from "../../src/core/index.js";
import { z } from "zod";

declare const caught: unknown;

if (isDoctureError(caught, "TIMEOUT")) {
  const stage: string = caught.stage;
  const ms: number = caught.ms;
  void stage;
  void ms;
}
if (isDoctureError(caught, "LOAD_FAILED")) {
  const attempts: readonly unknown[] | undefined = caught.attempts;
  void attempts;
}
if (isDoctureError(caught, "EVAL_SPEC_INVALID")) {
  const code: "EVAL_SPEC_INVALID" = caught.code;
  void code;
}
// @ts-expect-error A typo'd code is not a DoctureErrorCode.
isDoctureError(caught, "TIMEOT");
if (isDoctureError(caught, "LOAD_FAILED")) {
  // @ts-expect-error A LOAD_FAILED error has no stage.
  void caught.stage;
}

const outcome = await createExtractor({ loaders: [] }).safeExtract(new Uint8Array(), z.object({}));
if (!outcome.ok && isDoctureError(outcome.error, "CONTRACT_VIOLATION")) {
  const check: "schema" | "rule" = outcome.error.failedCheck;
  void check;
}

const code: DoctureErrorCode | undefined = errorCodeOf(caught);
switch (code) {
  case "TIMEOUT":
    break;
  // @ts-expect-error errorCodeOf returns the code union, so a typo'd case does not compile.
  case "TIMEOT":
    break;
}

if (isDoctureError(caught, "LOAD_FAILED")) {
  const attempts: readonly Attempt[] = caught.attempts;
  void attempts;
}
// @ts-expect-error An attempt's errorCode is a DoctureErrorCode, so a typo does not compile.
const typoCode: Attempt["errorCode"] = "TIMEOT";
void typoCode;

declare const conversion: SafeConversion;
if (!conversion.ok && isDoctureError(conversion.error, "NO_CONVERTIBLE_CONTENT")) {
  const textLength: number = conversion.error.features.textLength;
  void textLength;
}
const conversionError: DoctureError | Error | undefined = conversion.ok ? undefined : conversion.error;
void conversionError;
