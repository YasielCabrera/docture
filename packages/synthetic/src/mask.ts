import { formatPath, type PathSegment } from "./path.js";
import { isPlainObject } from "./schema.js";

type Leaf = string | number | boolean | bigint | null | undefined | Date | Uint8Array;

/** A position whose label is not the value itself but what the page lets a reader recover, such as a lossy enum display. */
export interface Printed<V, R> {
  readonly kind: "printed";
  /** The label for `value`, or `null` when nothing is printed. */
  print(value: NonNullable<V>, root: R): unknown;
}

/** Declare a position printed as `print(value)` rather than as its value. */
export function prints<V, R = never>(print: (value: NonNullable<V>, root: R) => unknown): Printed<V, R> {
  return { kind: "printed", print };
}

/** Whether a position prints: always, never, per value, or as a transform of the value. */
export type Flag<V, R, P> = boolean | ((value: NonNullable<V>, root: R, parent: P) => boolean) | Printed<V, R>;

/** A printed declaration for a value of type `V` inside root `R` and parent `P`. Objects and arrays may be declared per child. */
export type Mask<V, R, P> = NonNullable<V> extends Leaf
  ? Flag<V, R, P>
  : NonNullable<V> extends readonly (infer E)[]
    ? Flag<V, R, P> | { readonly items: Mask<E, R, NonNullable<V>> }
    : Flag<V, R, P> | ObjectMask<NonNullable<V>, R>;

/** Every key of `O` must be declared, optional ones included, so a new schema field fails to compile until each template decides. */
export type ObjectMask<O, R> = { readonly [K in keyof Required<O>]-?: Mask<O[K], R, O> };

/** The printed declaration of a template for values of type `T`. */
export type PrintedMask<T> = ObjectMask<T, T>;

/** The ground truth a template promises, and the concrete paths of its printed leaves with their labels. */
export interface Projection {
  /** The value with every unprinted position `null`. A group or array with nothing printed collapses to `null`. */
  readonly expected: unknown;
  /** Label value per printed leaf, keyed by concrete path. */
  readonly leaves: ReadonlyMap<string, unknown>;
}

export function project<T>(mask: PrintedMask<T>, root: T): Projection {
  const leaves = new Map<string, unknown>();
  const expected = visit(mask, root, root, undefined, [], leaves);
  return { expected, leaves };
}

function visit(mask: unknown, value: unknown, root: unknown, parent: unknown, at: PathSegment[], leaves: Map<string, unknown>): unknown {
  if (value === undefined || value === null) return null;
  if (typeof mask === "boolean" || typeof mask === "function") {
    const on = typeof mask === "boolean" ? mask : (mask as (v: unknown, r: unknown, p: unknown) => boolean)(value, root, parent) === true;
    if (!on) return null;
    collect(value, at, leaves);
    return value;
  }
  if (isPlainObject(mask) && mask.kind === "printed" && typeof mask.print === "function") {
    const label = (mask.print as (v: unknown, r: unknown) => unknown)(value, root);
    if (label === undefined || label === null) return null;
    leaves.set(formatPath(at), label);
    return label;
  }
  if (Array.isArray(value)) {
    if (!isPlainObject(mask) || !("items" in mask)) throw new TypeError(`The printed mask at ${formatPath(at) || "(root)"} needs { items } for an array`);
    if (value.length === 0) return neverPrinted(mask.items) ? null : [];
    const items = value.map((item, index) => visit(mask.items, item, root, value, [...at, index], leaves));
    return items.every((item) => item === null) ? null : items;
  }
  if (!isPlainObject(mask) || typeof value !== "object") throw new TypeError(`The printed mask at ${formatPath(at) || "(root)"} does not match the value`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(mask)) out[key] = visit(mask[key], (value as Record<string, unknown>)[key], root, value, [...at, key], leaves);
  return Object.values(out).every((child) => child === null) && at.length > 0 ? null : out;
}

/** A mask that cannot print anything, whatever the value. */
function neverPrinted(mask: unknown): boolean {
  if (mask === false) return true;
  if (!isPlainObject(mask) || mask.kind === "printed") return false;
  return "items" in mask && Object.keys(mask).length === 1 ? neverPrinted(mask.items) : Object.values(mask).every(neverPrinted);
}

function collect(value: unknown, at: PathSegment[], leaves: Map<string, unknown>): void {
  if (Array.isArray(value)) value.forEach((item, index) => collect(item, [...at, index], leaves));
  else if (isPlainObject(value)) for (const [key, child] of Object.entries(value)) collect(child, [...at, key], leaves);
  else if (value !== null && value !== undefined) leaves.set(formatPath(at), value);
}
