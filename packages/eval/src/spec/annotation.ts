import { byIndex, hungarian, ordered, type ArrayRule } from "../align/rules.js";
import { boxIoU } from "../compare/box.js";
import { oneOf, setOf } from "../compare/collections.js";
import { date } from "../compare/date.js";
import { exact } from "../compare/exact.js";
import { number } from "../compare/number.js";
import { identifier, text } from "../compare/text.js";
import type { Comparator } from "../compare/types.js";
import { isPlainObject } from "../json.js";

/** What an `x-docture-eval` annotation declares for one schema position. */
export interface Annotation {
  readonly comparator?: Comparator;
  readonly weight?: number;
  readonly critical?: boolean;
  readonly segment?: string;
  readonly align?: ArrayRule;
}

type Options = Readonly<Record<string, unknown>>;

function compact<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function read(options: Options) {
  const fail = (key: string, kind: string): never => {
    throw new RangeError(`option ${key} must be ${kind}`);
  };
  return {
    num: (key: string): number | undefined => (options[key] === undefined ? undefined : typeof options[key] === "number" ? options[key] : fail(key, "a number")),
    bool: (key: string): boolean | undefined => (options[key] === undefined ? undefined : typeof options[key] === "boolean" ? options[key] : fail(key, "a boolean")),
    str: (key: string): string | undefined => (options[key] === undefined ? undefined : typeof options[key] === "string" ? options[key] : fail(key, "a string")),
    choice: <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
      const value = options[key];
      if (value === undefined) return undefined;
      return allowed.find((item) => item === value) ?? fail(key, `one of ${allowed.join(", ")}`);
    },
    strings: (key: string): string[] | undefined => {
      const value = options[key];
      if (value === undefined) return undefined;
      return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fail(key, "a list of strings");
    },
    scalars: (key: string): (string | number | boolean)[] | undefined => {
      const value = options[key];
      if (value === undefined) return undefined;
      const valid = Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item));
      return valid ? (value as (string | number | boolean)[]) : fail(key, "a list of strings, numbers or booleans");
    },
    numbers: (key: string): Record<string, number> | undefined => {
      const value = options[key];
      if (value === undefined) return undefined;
      return isPlainObject(value) && Object.values(value).every((item) => typeof item === "number") ? (value as Record<string, number>) : fail(key, "an object of numbers");
    },
  };
}

type Reader = ReturnType<typeof read>;

const COMPARATORS: Readonly<Record<string, { readonly keys: readonly string[]; build(read: Reader, options: Options): Comparator }>> = {
  exact: { keys: ["normalize"], build: (r) => exact(compact({ normalize: r.choice("normalize", ["none", "case", "whitespace", "case-and-whitespace"] as const) })) },
  number: { keys: ["abs", "rel", "minorUnits"], build: (r) => number(compact({ abs: r.num("abs"), rel: r.num("rel"), minorUnits: r.num("minorUnits") })) },
  date: { keys: ["granularity", "formats"], build: (r) => date(compact({ granularity: r.choice("granularity", ["year", "month", "day", "instant"] as const), formats: r.strings("formats") })) },
  identifier: { keys: ["strip"], build: (r) => identifier(compact({ strip: r.str("strip") })) },
  text: {
    keys: ["minSimilarity", "metric", "tau", "digits"],
    build: (r) => text({
      minSimilarity: r.num("minSimilarity") ?? Number.NaN,
      ...compact({ metric: r.choice("metric", ["levenshtein", "anls"] as const), tau: r.num("tau"), digits: r.choice("digits", ["in-order", "ignore"] as const) }),
    }),
  },
  oneOf: { keys: ["values", "normalize"], build: (r) => oneOf(r.scalars("values") ?? [], compact({ normalize: r.choice("normalize", ["none", "case"] as const) })) },
  boxIoU: { keys: ["min"], build: (r) => boxIoU({ min: r.num("min") ?? 0.5 }) },
  setOf: {
    keys: ["of", "minSimilarity"],
    build: (r, options) => {
      const element = comparatorFrom(options.of);
      if (element === undefined) throw new RangeError("setOf needs an element comparator in of");
      return setOf(element, compact({ minSimilarity: r.num("minSimilarity") }));
    },
  },
};

const ALIGNMENTS: Readonly<Record<string, { readonly keys: readonly string[]; build(read: Reader): ArrayRule }>> = {
  index: { keys: [], build: () => byIndex() },
  ordered: { keys: ["minSimilarity", "maxCells"], build: (r) => ordered(compact({ minSimilarity: r.num("minSimilarity"), maxCells: r.num("maxCells") })) },
  hungarian: {
    keys: ["key", "minSimilarity", "weights", "maxCells"],
    build: (r) => hungarian(compact({ key: r.strings("key"), minSimilarity: r.num("minSimilarity"), weights: r.numbers("weights"), maxCells: r.num("maxCells") })),
  },
};

const SHARED_KEYS = ["compare", "align", "weight", "critical", "segment"];

function comparatorFrom(raw: unknown): Comparator | undefined {
  const options: Options = typeof raw === "string" ? { compare: raw } : isPlainObject(raw) ? raw : {};
  const id = options.compare;
  if (id === undefined) return undefined;
  if (typeof id !== "string") throw new RangeError("compare must name a built-in comparator");
  const factory = COMPARATORS[id];
  if (factory === undefined) throw new RangeError(`unknown comparator "${id}"; built-ins are ${Object.keys(COMPARATORS).join(", ")}. Use a fields rule for a custom comparator`);
  for (const key of Object.keys(options)) {
    if (!SHARED_KEYS.includes(key) && !factory.keys.includes(key)) throw new RangeError(`unknown option ${key} for ${id}`);
  }
  return factory.build(read(options), options);
}

/** Parse an `x-docture-eval` value. Throws a `RangeError` describing the first problem. */
export function parseAnnotation(raw: unknown): Annotation {
  if (typeof raw !== "string" && !isPlainObject(raw)) throw new RangeError("expected a comparator name or an object");
  const options: Options = typeof raw === "string" ? { compare: raw } : raw;
  const r = read(options);
  const comparator = comparatorFrom(options);
  let align: ArrayRule | undefined;
  const alignId = r.str("align");
  if (alignId !== undefined) {
    const factory = ALIGNMENTS[alignId];
    if (factory === undefined) throw new RangeError(`unknown align "${alignId}"; use ${Object.keys(ALIGNMENTS).join(", ")}`);
    for (const key of Object.keys(options)) {
      if (!SHARED_KEYS.includes(key) && !factory.keys.includes(key)) throw new RangeError(`unknown option ${key} for align ${alignId}`);
    }
    align = factory.build(r);
  }
  if (comparator === undefined && align === undefined) {
    for (const key of Object.keys(options)) if (!SHARED_KEYS.includes(key)) throw new RangeError(`unknown option ${key}`);
  }
  return compact({ comparator, align, weight: r.num("weight"), critical: r.bool("critical"), segment: r.str("segment") });
}
