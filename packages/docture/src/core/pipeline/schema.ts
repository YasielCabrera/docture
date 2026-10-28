/**
 * The output contract.
 *
 * We do NOT invent a schema abstraction. The AI SDK already ships one that accepts
 * Zod, Valibot, ArkType, any Standard Schema, and raw JSON Schema, and that infers
 * the output type from whichever you passed (`FlexibleSchema` / `InferSchema`).
 * Reusing it buys three things: no adapter code, types that compose exactly with
 * `generateText with Output.object`, and one definition of "valid" shared by the deterministic
 * parsers and the model path.
 */

import { asSchema, safeValidateTypes, type FlexibleSchema } from "@ai-sdk/provider-utils";
import { formatFieldPath } from "../domain/field-path.js";
import type { ValidationIssue } from "../domain/result.js";

/** A JSON Schema object. Structural, so we do not re-export the SDK's type. */
export type JsonSchemaObject = Record<string, unknown>;

export type ValidateResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * A contract with its promises already settled: the AI SDK allows `jsonSchema` to
 * be a promise, and we do not want every strategy awaiting it separately.
 */
export interface ResolvedSchema<T = unknown> {
  /** JSON Schema, for a prompt, a doc page, or a non-AI-SDK validator. */
  readonly jsonSchema: JsonSchemaObject;
  /**
   * The caller's original schema, untouched. Hand this to `generateText with Output.object` rather
   * than the JSON Schema — providers do better with the native shape, and a
   * round trip through JSON Schema loses refinements. Return the answer as the
   * model gave it, not the schema's transformed output: the pipeline validates
   * `outcome.data` with this schema, so a transform would otherwise run twice.
   */
  readonly flexible: FlexibleSchema<T>;
  validate(value: unknown): Promise<ValidateResult<T>>;
}

function issuesFromError(error: Error): readonly ValidationIssue[] {
  const cause = (error as { cause?: unknown }).cause;

  // Zod (and other Standard Schema libs) expose `issues` with a path array.
  const issues = (cause as { issues?: unknown } | undefined)?.issues;
  if (Array.isArray(issues)) {
    return issues.map((raw): ValidationIssue => {
      const issue = raw as { path?: unknown; message?: unknown };
      const path = Array.isArray(issue.path)
        ? formatFieldPath(issue.path.map((segment) =>
            typeof segment === "object" && segment !== null && "key" in segment
              ? String((segment as { key: unknown }).key)
              : String(segment)))
        : "";
      return { path, message: typeof issue.message === "string" ? issue.message : String(raw) };
    });
  }

  return [{ path: "", message: error.message }];
}

/**
 * Settle a caller's schema once, at the start of a run.
 *
 * `validate` goes through the SDK's `safeValidateTypes`, so a Zod schema, a
 * Valibot schema and a hand-written JSON Schema all validate by the same call —
 * and a schema with no validator (plain JSON Schema) is reported honestly rather
 * than silently passing.
 */
export async function resolveSchema<T>(schema: FlexibleSchema<T>): Promise<ResolvedSchema<T>> {
  const resolved = asSchema(schema);
  const jsonSchema = (await resolved.jsonSchema) as JsonSchemaObject;

  return {
    jsonSchema,
    flexible: schema,
    async validate(value: unknown): Promise<ValidateResult<T>> {
      const outcome = await safeValidateTypes<T>({ value, schema });
      if (outcome.success) return { ok: true, data: outcome.value };
      return { ok: false, issues: issuesFromError(outcome.error) };
    },
  };
}
