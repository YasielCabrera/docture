import type { EvalCase, TagValue } from "./case.js";
import { parsePathText } from "./path.js";

/** A value a slice function may return. `null` and `undefined` leave the case out of the slice. */
export type SliceValue = TagValue | null | undefined;

/** How to read a slice: a path into the case such as `tags.rendition`, or a function. */
export type SliceSpec<C> = string | ((item: C) => SliceValue);

/** Named slices over cases. */
export type SliceMap<T = unknown> = Readonly<Record<string, SliceSpec<EvalCase<T>>>>;

function readPath(item: unknown, path: string): SliceValue {
  const tokens = parsePathText(path);
  if (tokens === undefined) throw new RangeError(`Slice path "${path}" is not a path.`);
  let current = item;
  for (const token of tokens) {
    if (token.kind !== "key" || typeof current !== "object" || current === null) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[token.key];
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean" ? current : undefined;
}

/** Evaluate slices for one item. Absent values are left out. */
export function sliceValues<C>(slices: Readonly<Record<string, SliceSpec<C>>>, item: C): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const [name, spec] of Object.entries(slices)) {
    const value = typeof spec === "string" ? readPath(item, spec) : spec(item);
    if (value !== null && value !== undefined) out[name] = value;
  }
  return out;
}
