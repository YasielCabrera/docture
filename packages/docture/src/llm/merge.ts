/**
 * Merging partial extractions.
 *
 * `concatenate` and `paginate` both send the document in pieces and get a partial
 * answer per piece. Reassembling them needs one rule set, applied everywhere:
 *
 *   - **arrays concatenate.** A table split across pages is one table; page 2's rows
 *     come after page 1's.
 *   - **scalars: first present wins**, except a later same-type non-zero value
 *     replaces an earlier `0` or `false`. Mismatched types keep first-present.
 *   - **objects recurse**, so a nested address block merges field by field.
 *
 * A genuine early zero can be replaced by this rule. Nulls and blank strings
 * still cannot overwrite present values.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function mergeTwo(first: unknown, second: unknown): unknown {
  if (Array.isArray(first) && Array.isArray(second)) return [...first, ...second];

  if (isPlainObject(first) && isPlainObject(second)) {
    const merged: Record<string, unknown> = { ...first };
    for (const [key, value] of Object.entries(second)) {
      merged[key] = key in merged ? mergeTwo(merged[key], value) : value;
    }
    return merged;
  }

  if (first === 0 && typeof second === "number" && second !== 0) return second;
  if (first === false && second === true) return second;
  if (isPresent(first)) return first;
  return isPresent(second) ? second : first;
}

/** Fold partial extractions, in document order, into one. */
export function mergePartials(parts: readonly unknown[]): unknown {
  const usable = parts.filter((part) => part !== undefined && part !== null);
  if (usable.length === 0) return undefined;

  let merged: unknown = usable[0];
  for (let i = 1; i < usable.length; i += 1) {
    merged = mergeTwo(merged, usable[i]);
  }
  return merged;
}
