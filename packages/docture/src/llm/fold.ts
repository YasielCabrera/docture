import { formatFieldPath, type ConflictingValue, type ExtractionConflict } from "../core/index.js";

export interface MergePart {
  readonly data: unknown;
  /** 1-based pages the part was extracted from. */
  readonly pages: readonly number[];
}

/**
 * Where a merged leaf came from: the index of its part, and its path inside that part.
 * A class, so an origin never reads as an object tree with `part` and `path` keys.
 */
export class Origin {
  constructor(readonly part: number, readonly path: readonly (string | number)[]) {}
}

/** Mirrors the merged value: arrays and objects hold child trees, and every other value an origin. */
export type OriginTree = Origin | readonly OriginTree[] | { readonly [key: string]: OriginTree };

interface Tracked {
  readonly value: unknown;
  readonly origin: OriginTree;
}

/** Higher wins when two parts give the same scalar. */
export type OriginRank = (origin: Origin) => number;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function track(value: unknown, part: number, path: readonly (string | number)[] = []): OriginTree {
  if (Array.isArray(value)) return value.map((item, index) => track(item, part, [...path, index]));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, track(item, part, [...path, key])]));
  }
  return new Origin(part, path);
}

function preferred(first: Tracked, second: Tracked, rank: OriginRank | undefined): Tracked {
  if (rank === undefined || first.value !== second.value || !(first.origin instanceof Origin) || !(second.origin instanceof Origin)) {
    return first;
  }
  return rank(second.origin) > rank(first.origin) ? { value: first.value, origin: second.origin } : first;
}

function mergeTwo(first: Tracked, second: Tracked, rank: OriginRank | undefined): Tracked {
  if (Array.isArray(first.value) && Array.isArray(second.value)) {
    return {
      value: [...first.value, ...second.value],
      origin: [...first.origin as readonly OriginTree[], ...second.origin as readonly OriginTree[]],
    };
  }

  if (isPlainObject(first.value) && isPlainObject(second.value)) {
    const value: Record<string, unknown> = { ...first.value };
    const origin: Record<string, OriginTree> = { ...first.origin as Record<string, OriginTree> };
    const secondOrigin = second.origin as Record<string, OriginTree>;
    for (const [key, item] of Object.entries(second.value)) {
      const right: Tracked = { value: item, origin: secondOrigin[key] as OriginTree };
      const merged = key in value
        ? mergeTwo({ value: value[key], origin: origin[key] as OriginTree }, right, rank)
        : right;
      value[key] = merged.value;
      origin[key] = merged.origin;
    }
    return { value, origin };
  }

  if (first.value === 0 && typeof second.value === "number" && second.value !== 0) return second;
  if (first.value === false && second.value === true) return second;
  if (isPresent(first.value)) return preferred(first, second, rank);
  return isPresent(second.value) ? second : first;
}

type Seen = { value: ConflictingValue["value"]; pages: number[] };

type Shape = "scalar" | "object" | "array";

function shapeOf(value: unknown): Shape {
  if (Array.isArray(value)) return "array";
  return isPlainObject(value) ? "object" : "scalar";
}

function isJsonValue(value: unknown): value is Seen["value"] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    || (typeof value === "object" && value !== null);
}

function sameValue(first: unknown, second: unknown): boolean {
  if (typeof first === "string" && typeof second === "string") return first.trim() === second.trim();
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((item, index) => sameValue(item, second[index]));
  }
  if (isPlainObject(first) && isPlainObject(second)) {
    const keys = Object.keys(first);
    return keys.length === Object.keys(second).length && keys.every((key) => key in second && sameValue(first[key], second[key]));
  }
  return first === second;
}

function observe(value: unknown, path: readonly string[], pages: readonly number[], seen: Map<string, Seen[]>): void {
  if (path.length > 0 && isPresent(value) && isJsonValue(value)) {
    const key = formatFieldPath(path);
    const values = seen.get(key) ?? [];
    const match = values.find((entry) => sameValue(entry.value, value));
    if (match === undefined) values.push({ value, pages: [...pages] });
    else match.pages.push(...pages.filter((page) => !match.pages.includes(page)));
    seen.set(key, values);
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) observe(child, [...path, key], pages, seen);
  }
}

function conflicting(values: readonly Seen[]): boolean {
  const shapes = new Set(values.map((entry) => shapeOf(entry.value)));
  return shapes.size > 1 || values.filter((entry) => shapeOf(entry.value) === "scalar").length > 1;
}

export interface Fold {
  readonly data: unknown;
  readonly conflicts: readonly ExtractionConflict[];
  /** `undefined` when no part had data. */
  readonly origins: OriginTree | undefined;
}

/**
 * Fold parts in document order. `rank` decides which part a scalar that several parts
 * gave equally is credited to; the merged value is the same either way.
 */
export function foldParts(parts: readonly MergePart[], rank?: OriginRank): Fold {
  const seen = new Map<string, Seen[]>();
  let merged: Tracked | undefined;
  for (const [index, part] of parts.entries()) {
    if (part.data === undefined || part.data === null) continue;
    const tracked: Tracked = { value: part.data, origin: track(part.data, index) };
    merged = merged === undefined ? tracked : mergeTwo(merged, tracked, rank);
    observe(part.data, [], part.pages, seen);
  }
  const conflicts = [...seen.entries()]
    .filter(([, values]) => conflicting(values))
    .map(([path, values]) => ({ path, values }));
  return { data: merged?.value, conflicts, origins: merged?.origin };
}
