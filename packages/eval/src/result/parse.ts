import { RunStoreError } from "../errors.js";
import { isPlainObject } from "../json.js";
import { firstViolation } from "./schema-check.js";
import { RESULT_SCHEMA } from "./schema.js";
import { RESULT_FORMAT, RESULT_VERSION, type CaseResult, type EvalResult, type RunInfo } from "./types.js";

const CASE_RESULT = { $ref: "#/$defs/caseResult" };

function check(what: string, schema: Readonly<Record<string, unknown>>, json: unknown): void {
  const violation = firstViolation(RESULT_SCHEMA, schema, json);
  if (violation !== undefined) {
    throw new RunStoreError(`Not a valid ${what}: ${violation.path === "" ? "(root)" : violation.path} ${violation.message}.`, "format");
  }
}

/** Validate run metadata against the run definition in `result-v1.schema.json`. */
export function parseRunInfo(json: unknown): RunInfo {
  check("run info", { $ref: "#/$defs/runInfo" }, json);
  return json as RunInfo;
}

/** Validate one line of `cases.jsonl` against `result-v1.schema.json`. Throws {@link RunStoreError} with reason `format` naming the first bad path. */
export function parseCaseResult(json: unknown): CaseResult {
  check("case result", CASE_RESULT, json);
  return json as CaseResult;
}

/**
 * Validate a parsed `result.json` against `result-v1.schema.json`, every nested member included, and return it
 * as an {@link EvalResult}. Throws {@link RunStoreError} with reason `version` for another format version, or
 * `format` naming the first path that does not fit version 1.
 */
export function parseEvalResult(json: unknown): EvalResult {
  if (!isPlainObject(json)) throw new RunStoreError("Not a valid eval result: (root) must be an object.", "format");
  if (json.format !== RESULT_FORMAT) throw new RunStoreError(`Not a valid eval result: format must be "${RESULT_FORMAT}".`, "format");
  if (json.version !== RESULT_VERSION) {
    throw new RunStoreError(
      `Eval result version ${JSON.stringify(json.version)} is not supported; this @docture/eval reads version ${RESULT_VERSION}.`,
      "version",
    );
  }
  check("eval result", RESULT_SCHEMA, json);
  return json as unknown as EvalResult;
}
