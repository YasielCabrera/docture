import { isValidIban, isValidLuhn } from "./generators.js";
import { formatPath, parsePath, type PathPattern, type PathSegment } from "./path.js";

/** A cross-field rule a sample must satisfy. `check` returns the violations it finds. */
export interface Constraint<T> {
  readonly name: string;
  check(value: T): readonly string[];
}

/** Every `[concretePath, value]` at a pattern such as `lineItems[].amount`. Absent positions are skipped. */
export function valuesAt(root: unknown, pattern: string): readonly (readonly [string, unknown])[] {
  const segments = parsePath(pattern);
  if (segments === undefined) throw new RangeError(`"${pattern}" is not a path`);
  const out: (readonly [string, unknown])[] = [];
  const walk = (value: unknown, index: number, at: PathSegment[]): void => {
    if (value === undefined) return;
    if (index === segments.length) {
      out.push([formatPath(at), value]);
      return;
    }
    const segment = segments[index] as PathSegment;
    if (segment === -1) {
      if (Array.isArray(value)) value.forEach((item, i) => walk(item, index + 1, [...at, i]));
    } else if (typeof segment === "number") {
      if (Array.isArray(value)) walk(value[segment], index + 1, [...at, segment]);
    } else if (typeof value === "object" && value !== null) {
      walk((value as Record<string, unknown>)[segment], index + 1, [...at, segment]);
    }
  };
  walk(root, 0, []);
  return out;
}

const single = (root: unknown, path: string): unknown => valuesAt(root, path)[0]?.[1];

/** A custom rule. Return a message, a list of messages, or nothing when satisfied. */
export function constraint<T>(name: string, check: (value: T) => string | readonly string[] | undefined): Constraint<T> {
  return {
    name,
    check(value) {
      const result = check(value);
      return result === undefined ? [] : typeof result === "string" ? [result] : result;
    },
  };
}

/** The numbers at `items` sum to the number at `total`, within `tolerance`. */
export function sumOf<T>(items: PathPattern<T>, total: PathPattern<T>, options: { readonly tolerance?: number } = {}): Constraint<T> {
  return constraint(`sumOf(${items}, ${total})`, (value) => {
    const sum = valuesAt(value, items).reduce((acc, [, item]) => acc + (typeof item === "number" ? item : Number.NaN), 0);
    const expected = single(value, total);
    if (typeof expected !== "number") return `${total} is not a number`;
    return Math.abs(sum - expected) > (options.tolerance ?? 0) ? `${items} sums to ${sum}, but ${total} is ${expected}` : undefined;
  });
}

/** The ISO date at `earlier` is before (or equal to, with `orEqual`) the one at `later`. Absent dates pass. */
export function before<T>(earlier: PathPattern<T>, later: PathPattern<T>, options: { readonly orEqual?: boolean } = {}): Constraint<T> {
  return constraint(`before(${earlier}, ${later})`, (value) => {
    const a = single(value, earlier);
    const b = single(value, later);
    if (a === undefined || a === null || b === undefined || b === null) return undefined;
    const ok = options.orEqual === true ? String(a) <= String(b) : String(a) < String(b);
    return ok ? undefined : `${earlier} (${String(a)}) is not before ${later} (${String(b)})`;
  });
}

/** Every value at `pattern` is a valid IBAN. */
export function validIban<T>(pattern: PathPattern<T>): Constraint<T> {
  return constraint(`validIban(${pattern})`, (value) =>
    valuesAt(value, pattern)
      .filter(([, item]) => item !== null && !(typeof item === "string" && isValidIban(item)))
      .map(([path, item]) => `${path} (${String(item)}) is not a valid IBAN`),
  );
}

/** Every value at `pattern` passes the Luhn check. */
export function validLuhn<T>(pattern: PathPattern<T>): Constraint<T> {
  return constraint(`validLuhn(${pattern})`, (value) =>
    valuesAt(value, pattern)
      .filter(([, item]) => item !== null && !(typeof item === "string" && isValidLuhn(item)))
      .map(([path, item]) => `${path} (${String(item)}) fails the Luhn check`),
  );
}

/** Values at `pattern` are pairwise distinct. */
export function unique<T>(pattern: PathPattern<T>): Constraint<T> {
  return constraint(`unique(${pattern})`, (value) => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const [path, item] of valuesAt(value, pattern)) {
      const key = JSON.stringify(item);
      const first = seen.get(key);
      if (first !== undefined) problems.push(`${path} repeats ${first}`);
      else seen.set(key, path);
    }
    return problems;
  });
}
