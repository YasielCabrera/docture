import type { PathSegment } from "./path.js";
import type { Stream } from "./rng.js";
import type { JsonSchema } from "./schema.js";

/** What a generator sees at one concrete position. */
export interface GenContext {
  /** A stream keyed by this position's concrete path. */
  readonly stream: Stream;
  readonly path: string;
  readonly segments: readonly PathSegment[];
  /** The JSON Schema node at this position. */
  readonly schema: JsonSchema;
  /** The nearest enclosing array index, if any. */
  readonly index: number | undefined;
  /** The value at another concrete path, resolved on demand. `undefined` when absent. */
  get<V = unknown>(path: string): V;
  /** The value of a sibling key in the enclosing object. */
  sibling<V = unknown>(key: string): V;
  /** The value the schema alone would produce here. */
  fallback(): unknown;
}

/** Produces the value at one position. */
export interface Generator<V> {
  readonly kind: "generator";
  generate(context: GenContext): V;
  /** The builder and arguments that made this generator, so a corpus can tell when a model's generators change. */
  readonly source?: unknown;
}

/** Sets the length of an array; its items are generated per position. */
export interface ArrayLength {
  readonly kind: "length";
  readonly length: number | readonly [min: number, max: number];
}

/** What a model or scenario may say about one schema position. */
export type FieldSpec<V> = Generator<V> | (NonNullable<V> extends readonly unknown[] ? ArrayLength : never);

const generator = <V>(generate: (context: GenContext) => V, source?: unknown): Generator<V> =>
  source === undefined ? { kind: "generator", generate } : { kind: "generator", generate, source };

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const WORDS = [
  "service", "consulting", "delivery", "license", "support", "material", "hardware", "maintenance", "freight", "storage",
  "design", "review", "installation", "training", "subscription", "repair", "cleaning", "inspection", "rental", "transport",
  "annual", "monthly", "premium", "standard", "express", "basic", "extended", "partial", "final", "additional",
];

const DAY = 86_400_000;
const toDay = (iso: string): number => {
  const time = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  // Date.parse rolls an impossible day such as 2025-02-29 into the next month.
  if (Number.isNaN(time) || fromDay(time / DAY) !== iso.slice(0, 10)) throw new RangeError(`"${iso}" is not an ISO date`);
  return Math.round(time / DAY);
};
function fromDay(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}
const range = (stream: Stream, value: number | readonly [number, number]): number =>
  typeof value === "number" ? value : stream.int(value[0], value[1]);

/** Replace letters with mod-97 check digits, as ISO 13616 requires. */
export function ibanCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`.toUpperCase().replace(/[A-Z]/gu, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return String(98 - remainder).padStart(2, "0");
}

export function isValidIban(value: string): boolean {
  const compact = value.replace(/\s+/gu, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/u.test(compact)) return false;
  return ibanCheckDigits(compact.slice(0, 2), compact.slice(4)) === compact.slice(2, 4);
}

export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let digit = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidLuhn(value: string): boolean {
  const digits = value.replace(/\s+/gu, "");
  return /^\d{2,}$/u.test(digits) && luhnCheckDigit(digits.slice(0, -1)) === Number(digits.at(-1));
}

const IBAN_LENGTHS: Readonly<Record<string, number>> = { DE: 18, AT: 16, CH: 17, FR: 23, ES: 20, IT: 23, NL: 14, BE: 12, GB: 18, PL: 24 };

/** Built-in generators. They draw only from the position's own stream. */
export const gen = {
  /** Always `value`. */
  value: <V>(value: V): Generator<V> => generator(() => value, ["value", value]),
  /** A custom generator. */
  from: <V>(generate: (context: GenContext) => V): Generator<V> => generator(generate),
  int: (min: number, max: number): Generator<number> => generator(({ stream }) => stream.int(min, max), ["int", min, max]),
  /** A float rounded to `decimals` places. */
  float: (min: number, max: number, options: { readonly decimals?: number } = {}): Generator<number> =>
    generator(({ stream }) => {
      const factor = 10 ** (options.decimals ?? 2);
      return Math.round(stream.float(min, max) * factor) / factor;
    }, ["float", min, max, options]),
  pick: <V>(items: readonly V[]): Generator<V> => generator(({ stream }) => stream.pick(items), ["pick", items]),
  weighted: <V>(items: readonly (readonly [value: V, weight: number])[]): Generator<V> =>
    generator(({ stream }) => {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = stream.float(0, total);
      for (const [value, weight] of items) {
        roll -= weight;
        if (roll < 0) return value;
      }
      const last = items.at(-1);
      if (last === undefined) throw new RangeError("weighted() needs at least one item");
      return last[0];
    }, ["weighted", items]),
  /** `#` a digit, `A` an uppercase letter, `?` either; a backslash escapes the next character. */
  pattern: (pattern: string): Generator<string> =>
    generator(({ stream }) => {
      let out = "";
      for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i] as string;
        if (char === "\\") out += pattern[++i] ?? "";
        else if (char === "#") out += stream.pick([...DIGITS]);
        else if (char === "A") out += stream.pick([...UPPER]);
        else if (char === "?") out += stream.pick([...UPPER, ...DIGITS]);
        else out += char;
      }
      return out;
    }, ["pattern", pattern]),
  /** An ISO date (`YYYY-MM-DD`) in `[from, to]`. */
  date: (options: { readonly from: string; readonly to: string }): Generator<string> =>
    generator(({ stream }) => fromDay(stream.int(toDay(options.from), toDay(options.to))), ["date", options]),
  /** An ISO date `days` after the date at concrete path `path`. */
  dateAfter: (path: string, options: { readonly days: number | readonly [number, number] }): Generator<string> =>
    generator((context) => {
      const base = context.get<unknown>(path);
      if (typeof base !== "string") throw new RangeError(`dateAfter("${path}") needs an ISO date there, found ${JSON.stringify(base)}`);
      return fromDay(toDay(base) + range(context.stream, options.days));
    }, ["dateAfter", path, options]),
  words: (min: number, max: number, pool: readonly string[] = WORDS): Generator<string> =>
    generator(({ stream }) => Array.from({ length: stream.int(min, max) }, () => stream.pick(pool)).join(" "), ["words", min, max, pool]),
  /** A valid IBAN for `country` with a random numeric BBAN. */
  iban: (country = "DE"): Generator<string> =>
    generator(({ stream }) => {
      const length = IBAN_LENGTHS[country];
      if (length === undefined) throw new RangeError(`iban() has no BBAN length for ${country}`);
      const bban = Array.from({ length }, () => stream.pick([...DIGITS])).join("");
      return `${country}${ibanCheckDigits(country, bban)}${bban}`;
    }, ["iban", country]),
  /** Digits that pass the Luhn check, such as card or account numbers. */
  luhn: (prefix: string, length: number): Generator<string> =>
    generator(({ stream }) => {
      const body = prefix + Array.from({ length: length - prefix.length - 1 }, () => stream.pick([...DIGITS])).join("");
      return body + String(luhnCheckDigit(body));
    }, ["luhn", prefix, length]),
  /** Leave an optional field out. */
  absent: <V = never>(): Generator<V | undefined> => generator(() => undefined, ["absent"]),
  /** `null` for a nullable field. */
  null: <V = never>(): Generator<V | null> => generator(() => null, ["null"]),
  /** `inner` with probability `p`, otherwise absent. */
  maybe: <V>(inner: Generator<V>, p = 0.5): Generator<V | undefined> =>
    generator((context) => (context.stream.fork("maybe").chance(p) ? inner.generate(context) : undefined), ["maybe", inner, p]),
  /** The length of an array whose items are generated per position. */
  array: (options: { readonly length: number | readonly [number, number] }): ArrayLength => ({ kind: "length", length: options.length }),
} as const;

export const internal = { toDay, fromDay, range, WORDS };
