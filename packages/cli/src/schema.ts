/**
 * `--schema ./invoice.ts` → a `FlexibleSchema`.
 *
 * The library's contract type accepts Zod, Valibot, ArkType, any Standard Schema,
 * an AI SDK `Schema`, and raw JSON Schema — but a JSON Schema is the one form that
 * arrives as a bare object, and `asSchema` would try to CALL a bare object (it
 * treats an unrecognised value as a lazy-schema thunk). So the shape is checked
 * here, once, and the failure is a sentence instead of "schema is not a function".
 */

import type { FlexibleSchema } from "docture";
import { jsonSchema } from "ai";
import { UsageError } from "./cli/errors.js";
import { loadExport } from "./load-module.js";

const JSON_SCHEMA_KEYS = [
  "type",
  "properties",
  "$schema",
  "$ref",
  "anyOf",
  "oneOf",
  "allOf",
  "enum",
] as const;

function looksLikeJsonSchema(value: object): boolean {
  return JSON_SCHEMA_KEYS.some((key) => key in value);
}

export interface RecognisedSchema {
  readonly schema: FlexibleSchema;
  /**
   * Whether the schema can CHECK a value, as opposed to merely describing one.
   *
   * A bare JSON Schema cannot: it tells the model what shape to produce and then
   * accepts whatever comes back, because there is no validator attached to it and
   * this package will not grow a JSON Schema engine to invent one. That is a
   * meaningful difference in what `extract` guarantees, so it is carried out of
   * here and said out loud rather than left for someone to discover.
   */
  readonly validates: boolean;
}

export function toFlexibleSchema(value: unknown, from: string): RecognisedSchema {
  // A thunk — the AI SDK's `LazySchema`.
  if (typeof value === "function") return { schema: value as FlexibleSchema, validates: true };

  if (typeof value !== "object" || value === null) {
    throw new UsageError(
      `The schema exported by "${from}" is a ${value === null ? "null" : typeof value}, not a schema.`,
      "Export a Zod (or Valibot, or ArkType) schema, or a JSON Schema object.",
    );
  }

  // Zod, Valibot, ArkType and anything else implementing Standard Schema.
  if ("~standard" in value) return { schema: value as FlexibleSchema, validates: true };

  // Already wrapped by the AI SDK's `jsonSchema()` — which validates only if the
  // caller passed a `validate`.
  if ("jsonSchema" in value) {
    return {
      schema: value as FlexibleSchema,
      validates: typeof (value as { validate?: unknown }).validate === "function",
    };
  }

  if (looksLikeJsonSchema(value)) {
    return { schema: jsonSchema(value as Record<string, never>), validates: false };
  }

  throw new UsageError(
    `"${from}" does not export something recognisable as a schema.`,
    "Expected a Standard Schema (Zod, Valibot, ArkType) or a JSON Schema object with a `type`.",
  );
}

export interface SchemaSource {
  readonly schema: FlexibleSchema;
  /** For `--verbose`: which file and which export it came from. */
  readonly describe: string;
  /** Empty unless something about this schema is worth saying before the run. */
  readonly warnings: readonly string[];
}

const NO_VALIDATOR =
  "A JSON Schema describes the output but cannot check it — the model's answer is " +
  "not verified against it. Export a Zod, Valibot or ArkType schema to have it enforced.";

/**
 * The schema for this run: the flag, else the config's.
 *
 * Absent from both is a usage error rather than a default, because there is no
 * sensible default shape for "what is in this document" and guessing one would
 * produce an expensive, confidently wrong answer.
 */
export async function resolveSchemaSource(options: {
  readonly specifier?: string;
  readonly fromConfig?: FlexibleSchema;
  readonly cwd: string;
  readonly command: string;
}): Promise<SchemaSource> {
  if (options.specifier !== undefined) {
    const loaded = await loadExport<unknown>(options.specifier, {
      kind: "schema",
      cwd: options.cwd,
      names: ["schema", "Schema"],
    });
    const recognised = toFlexibleSchema(loaded.value, loaded.from);
    return {
      schema: recognised.schema,
      describe: `schema ${loaded.from}#${loaded.exportName}`,
      warnings: recognised.validates ? [] : [NO_VALIDATOR],
    };
  }

  if (options.fromConfig !== undefined) {
    // A config's schema is a value the author imported, not a file we parsed, so
    // it is taken as given — including whether it validates.
    return { schema: options.fromConfig, describe: "schema from config", warnings: [] };
  }

  throw new UsageError(
    `\`docture ${options.command}\` needs a schema.`,
    "Pass --schema ./invoice.ts, or set `schema` in docture.config.ts.",
  );
}
