/**
 * Field paths in `@docture/eval`'s format, so labels key eval's `locations` directly.
 * A concrete path addresses one value, as in `lineItems[3].amount`. A pattern addresses
 * a schema position, as in `lineItems[].amount`. A key that is empty or contains
 * `.`, `[`, `]`, `*`, `` ` `` or `\` is wrapped in backticks with `` ` `` and `\` escaped.
 */

export type PathSegment = string | number;

const PLAIN_KEY = /^[^.[\]*`\\]+$/u;

export function formatKey(key: string): string {
  return PLAIN_KEY.test(key) ? key : `\`${key.replace(/[\\`]/gu, "\\$&")}\``;
}

/** `formatPath(["lineItems", 3, "amount"])` is `lineItems[3].amount`; an index of `-1` formats as `[]`. */
export function formatPath(segments: readonly PathSegment[]): string {
  let path = "";
  for (const segment of segments) {
    if (typeof segment === "number") path += segment < 0 ? "[]" : `[${segment}]`;
    else path += path === "" ? formatKey(segment) : `.${formatKey(segment)}`;
  }
  return path;
}

/** The pattern of a concrete position: indices become `[]`. */
export function formatPattern(segments: readonly PathSegment[]): string {
  return formatPath(segments.map((segment) => (typeof segment === "number" ? -1 : segment)));
}

/** Parse a concrete path or pattern. `[]` parses to `-1`. Returns `undefined` for text no path formats to. */
export function parsePath(text: string): PathSegment[] | undefined {
  const segments: PathSegment[] = [];
  let i = 0;
  const readKey = (): string | undefined => {
    if (text[i] === "`") {
      let key = "";
      i++;
      while (i < text.length && text[i] !== "`") {
        if (text[i] === "\\") i++;
        key += text[i] ?? "";
        i++;
      }
      if (text[i] !== "`") return undefined;
      i++;
      return key;
    }
    const start = i;
    while (i < text.length && !".[".includes(text[i] as string)) i++;
    const key = text.slice(start, i);
    return key !== "" && formatKey(key) === key ? key : undefined;
  };
  while (i < text.length) {
    if (text[i] === "[") {
      const end = text.indexOf("]", i);
      if (end < 0) return undefined;
      const inner = text.slice(i + 1, end);
      if (inner === "") segments.push(-1);
      else if (/^\d+$/u.test(inner)) segments.push(Number(inner));
      else return undefined;
      i = end + 1;
      continue;
    }
    if (segments.length > 0) {
      if (text[i] !== ".") return undefined;
      i++;
    }
    const key = readKey();
    if (key === undefined) return undefined;
    segments.push(key);
  }
  return segments;
}

type Leaf = string | number | boolean | bigint | null | undefined | Date | Uint8Array;
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7];

type Suffix<V, Index extends string, D extends number> = [D] extends [never]
  ? never
  : NonNullable<V> extends Leaf
    ? never
    : NonNullable<V> extends readonly (infer E)[]
      ? Index | `${Index}${Suffix<E, Index, Depth[D]>}`
      : { [K in keyof NonNullable<V> & string]-?: `.${K}` | `.${K}${Suffix<NonNullable<V>[K], Index, Depth[D]>}` }[keyof NonNullable<V> & string];

type Paths<T, Index extends string> = {
  [K in keyof T & string]-?: K | `${K}${Suffix<T[K], Index, 7>}`;
}[keyof T & string];

/** Every schema position of `T`, as in `lineItems[].amount`. */
export type PathPattern<T> = Paths<T, "[]">;

/** Every concrete position of `T`, as in `lineItems[${number}].amount`. */
export type ConcretePath<T> = Paths<T, `[${number}]`>;

type AtDot<V, P extends string> = P extends `${infer K}.${infer R}`
  ? K extends keyof NonNullable<V>
    ? ValueAt<NonNullable<V>[K], R>
    : never
  : P extends keyof NonNullable<V>
    ? NonNullable<V>[P]
    : never;

/** The type found at pattern `P` of `V`. */
export type ValueAt<V, P extends string> = P extends ""
  ? V
  : P extends `[]${infer R}`
    ? NonNullable<V> extends readonly (infer E)[]
      ? ValueAt<E, R>
      : never
    : P extends `.${infer R}`
      ? ValueAt<V, R>
      : P extends `${infer K}[]${infer R}`
        ? K extends `${string}.${string}`
          ? AtDot<V, P>
          : K extends keyof NonNullable<V>
            ? ValueAt<NonNullable<V>[K], `[]${R}`>
            : never
        : AtDot<V, P>;
