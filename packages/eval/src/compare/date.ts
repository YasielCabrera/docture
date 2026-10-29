import { definedOptions, oneOfValues } from "./options.js";
import { MATCH, type Comparator, type Comparison } from "./types.js";

/** How much of a date must agree. `instant` compares the exact moment of an ISO date-time. */
export type DateGranularity = "year" | "month" | "day" | "instant";

export interface DateOptions {
  /** Default `"day"`. */
  readonly granularity?: DateGranularity;
  /**
   * Extra accepted layouts built from `YYYY`, `MM`, `M`, `DD` and `D` with literal
   * separators, such as `"DD/MM/YYYY"`. ISO dates and English month names are always accepted.
   */
  readonly formats?: readonly string[];
}

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

type Parser = (text: string) => CalendarDate | undefined;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function calendar(year: number, month: number, day: number): CalendarDate | undefined {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (maxDay === undefined || !Number.isInteger(day) || day < 1 || day > maxDay) return undefined;
  return { year, month, day };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:z|[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?)?)?$/u;
const NAMED = /^(?:([a-z]+)\.? (\d{1,2}),?|(\d{1,2}) ([a-z]+)\.?,?) (\d{4})$/u;

const parseIso: Parser = (text) => {
  const match = ISO.exec(text);
  return match === null ? undefined : calendar(Number(match[1]), Number(match[2]), Number(match[3]));
};

const parseNamed: Parser = (text) => {
  const match = NAMED.exec(text);
  if (match === null) return undefined;
  const name = match[1] ?? match[4];
  const month = MONTHS.findIndex((entry) => entry === name || entry.slice(0, 3) === name) + 1;
  return calendar(Number(match[5]), month, Number(match[2] ?? match[3]));
};

const FORMAT_TOKEN = /YYYY|MM|M|DD|D/gu;

/** Compile a layout such as `DD/MM/YYYY`. Throws a `RangeError` for a layout without a year, month and day. */
export function compileDateFormat(format: string): Parser {
  const order: ("year" | "month" | "day")[] = [];
  let source = "";
  let last = 0;
  for (const match of format.matchAll(FORMAT_TOKEN)) {
    source += format.slice(last, match.index).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const token = match[0];
    order.push(token === "YYYY" ? "year" : token.startsWith("M") ? "month" : "day");
    source += token === "YYYY" ? "(\\d{4})" : token.length === 2 ? "(\\d{2})" : "(\\d{1,2})";
    last = match.index + token.length;
  }
  source += format.slice(last).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (order.length !== 3 || new Set(order).size !== 3) {
    throw new RangeError(`date: format "${format}" needs exactly one year, one month and one day token.`);
  }
  const regex = new RegExp(`^${source}$`, "u");
  return (text) => {
    const match = regex.exec(text);
    if (match === null) return undefined;
    const parts = { year: 0, month: 0, day: 0 };
    order.forEach((part, index) => {
      parts[part] = Number(match[index + 1]);
    });
    return calendar(parts.year, parts.month, parts.day);
  };
}

const ALTERNATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY", "DD-MM-YYYY", "YYYY/MM/DD", "YYYYMMDD", "D/M/YYYY", "M/D/YYYY"];
let alternates: readonly (readonly [string, Parser])[] | undefined;
function alternateParsers(): readonly (readonly [string, Parser])[] {
  alternates ??= ALTERNATE_FORMATS.map((format) => [format, compileDateFormat(format)] as const);
  return alternates;
}

/** Parse an ISO date, ISO date-time or English month-name date to its calendar day. */
export function parseCalendarDate(value: unknown): CalendarDate | undefined {
  return parseWith([parseIso, parseNamed], value);
}

function parseWith(parsers: readonly Parser[], value: unknown): CalendarDate | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase().replace(/\s+/gu, " ");
  for (const parser of parsers) {
    const parsed = parser(text);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function instantOf(value: unknown): number | undefined {
  if (typeof value !== "string" || parseIso(value.trim().toLowerCase()) === undefined) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? undefined : ms;
}

const SAME: Readonly<Record<Exclude<DateGranularity, "instant">, (a: CalendarDate, b: CalendarDate) => boolean>> = {
  year: (a, b) => a.year === b.year,
  month: (a, b) => a.year === b.year && a.month === b.month,
  day: (a, b) => a.year === b.year && a.month === b.month && a.day === b.day,
};

function partialSimilarity(a: CalendarDate, b: CalendarDate): number {
  return ((a.year === b.year ? 1 : 0) + (a.month === b.month ? 1 : 0) + (a.day === b.day ? 1 : 0)) / 3;
}

/** Calendar dates at a granularity. Mismatches that are the right date in another layout, or with day and month swapped, get a `date-format` hint. */
export function date(options: DateOptions = {}): Comparator {
  const granularity = oneOfValues("date", "granularity", options.granularity, ["year", "month", "day", "instant"]) ?? "day";
  const parsers = [parseIso, parseNamed, ...(options.formats ?? []).map(compileDateFormat)];
  return {
    id: "date",
    options: definedOptions({ granularity: options.granularity ?? "day", formats: options.formats === undefined ? undefined : [...options.formats] }),
    compare(expected, actual): Comparison {
      if (granularity === "instant") {
        const e = instantOf(expected);
        const a = instantOf(actual);
        if (e === undefined || a === undefined) return { match: false, similarity: 0, note: "not an ISO date-time" };
        return e === a ? MATCH : { match: false, similarity: Math.abs(e - a) < 86_400_000 ? 0.5 : 0 };
      }
      const same = SAME[granularity];
      const e = parseWith(parsers, expected);
      if (e === undefined) return { match: false, similarity: 0, note: "expected value is not a date" };
      const a = parseWith(parsers, actual);
      if (a === undefined) {
        for (const [format, parser] of alternateParsers()) {
          const alternate = parseWith([parser], actual);
          if (alternate !== undefined && same(e, alternate)) {
            return { match: false, similarity: 0.9, hint: { kind: "date-format", detail: `actual uses ${format}` } };
          }
        }
        return { match: false, similarity: 0, note: "not a date" };
      }
      if (same(e, a)) return MATCH;
      const swapped = calendar(a.year, a.day, a.month);
      if (swapped !== undefined && same(e, swapped)) {
        return { match: false, similarity: partialSimilarity(e, a), hint: { kind: "date-format", detail: "day and month swapped" } };
      }
      return { match: false, similarity: partialSimilarity(e, a) };
    },
    check(expected) {
      const valid = granularity === "instant" ? instantOf(expected) !== undefined : parseWith(parsers, expected) !== undefined;
      return valid ? undefined : "expected a date in an accepted layout";
    },
  };
}
