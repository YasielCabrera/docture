/**
 * Relaxing a schema for multi-request extraction.
 *
 * THE BUG THIS EXISTS TO FIX: under `paginate` or `concatenate` each request sees
 * only part of the document, so page 2 legitimately has no invoice number. But
 * `generateObject` validates every response against the schema it was given — so a
 * strict schema makes the model's honest partial answer a hard failure ("response did
 * not match schema"), and the document fails even though every field was readable
 * somewhere.
 *
 * So: requests over a FRAGMENT get a schema with `required` stripped, the fragments
 * are merged, and the MERGED result is validated once against the caller's strict
 * schema by the pipeline. Strictness is enforced exactly where the whole document is
 * in view, which is the only place it can be enforced correctly.
 *
 * A single-request extraction skips all of this and uses the caller's schema
 * untouched — no fidelity lost in the common case.
 */

export type JsonSchemaLike = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonSchemaLike {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively drop every `required` list.
 *
 * Only `required` — types, descriptions, enums and nesting all survive, because the
 * model still needs them to produce the right SHAPE for the fields it did find.
 * Dropping `required` says "any subset is acceptable", which is exactly true of a
 * fragment.
 */
export function relaxJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => relaxJsonSchema(entry));
  if (!isPlainObject(schema)) return schema;

  const relaxed: JsonSchemaLike = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "required" && Array.isArray(value)) continue;
    relaxed[key] = relaxJsonSchema(value);
  }
  return relaxed;
}
