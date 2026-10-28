import type { LineSourceId, SourceLine } from "../core/index.js";

const WORD = /(?![\u00B2\u00B3\u00B9\u2070-\u209F])[\p{L}\p{N}]/u;
const DIGIT = /(?![\u00B2\u00B3\u00B9\u2070-\u209F])\p{N}/u;
const SIGNS = new Set(["-", "−", "+"]);
const CURRENCY = /^\p{Sc}$/u;

/**
 * NFKC, except that superscripts and vulgar fractions stay as printed so `100¹` never
 * reads as 1001 nor `5½` as 51. `keepGroups` also leaves the digit-grouping no-break spaces.
 */
function normalizeForm(text: string, keepGroups = false): string {
  return text.replace(keepGroups ? /[^\p{No}\u00A0\u202F]+/gu : /[^\p{No}]+/gu, (part) => part.normalize("NFKC"));
}

export function normalizeText(text: string): string {
  return normalizeForm(text).replace(/\s+/gu, " ").trim();
}

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && DIGIT.test(char);
}

function joined(text: string, at: number): boolean {
  const before = text[at - 1];
  const after = text[at + 1];
  switch (text[at]) {
    case ".":
    case ",":
      return isDigit(after) || (isWord(before) && isWord(after));
    case "'":
    case "/":
    case "-":
      return isWord(before) && isWord(after);
    case ":":
    case "\u00A0":
    case "\u202F":
      return isDigit(before) && isDigit(after);
    case " ":
      return isDigit(before) && /^\d{3}(?!\d)/u.test(text.slice(at + 1));
    default:
      return false;
  }
}

function clearBefore(text: string, start: number, digitEdge: boolean): boolean {
  const char = text[start - 1];
  if (char === undefined) return true;
  return !isWord(char) && !(digitEdge && joined(text, start - 1));
}

function clearAfter(text: string, end: number, digitEdge: boolean): boolean {
  const char = text[end];
  if (char === undefined) return true;
  return !isWord(char) && !(digitEdge && joined(text, end));
}

function lineOrder(id: LineSourceId): readonly [number, number] {
  const [, page, line] = /^p(\d+)-line-(\d+)$/u.exec(id) ?? [];
  return [Number(page), Number(line)];
}

export function inLineOrder(lines: readonly SourceLine[]): SourceLine[] {
  return [...lines].sort((first, second) => {
    const [pageA, lineA] = lineOrder(first.id);
    const [pageB, lineB] = lineOrder(second.id);
    return pageA - pageB || lineA - lineB;
  });
}

function runsOf(lines: readonly SourceLine[]): SourceLine[][] {
  const runs: SourceLine[][] = [];
  let previous: readonly [number, number] | undefined;
  for (const line of lines) {
    const order = lineOrder(line.id);
    const run = runs.at(-1);
    if (run !== undefined && previous !== undefined && previous[0] === order[0] && previous[1] + 1 === order[1]) run.push(line);
    else runs.push([line]);
    previous = order;
  }
  return runs;
}

function matchString(value: string, lines: readonly SourceLine[]): LineSourceId[] | undefined {
  const needle = normalizeText(value);
  if (needle === "") return undefined;
  const first = needle[0];
  const last = needle.at(-1);
  for (const run of runsOf(lines)) {
    const texts = run.map((line) => normalizeText(line.text));
    const starts: number[] = [];
    let haystack = "";
    for (const [index, text] of texts.entries()) {
      if (index > 0) haystack += " ";
      starts.push(haystack.length);
      haystack += text;
    }
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      const bounded = (!isWord(first) || clearBefore(haystack, at, isDigit(first))) &&
        (!isWord(last) || clearAfter(haystack, end, isDigit(last)));
      if (bounded) {
        return run
          .filter((_, index) => (starts[index] ?? 0) < end && (starts[index] ?? 0) + (texts[index]?.length ?? 0) > at)
          .map((line) => line.id);
      }
    }
  }
  return undefined;
}

function canonical(integer: string, fraction: string, negative: boolean): string {
  const whole = integer.replace(/^0+/u, "") || "0";
  const part = fraction.replace(/0+$/u, "");
  const text = part === "" ? whole : `${whole}.${part}`;
  return negative && text !== "0" ? `-${text}` : text;
}

function groupedDigits(text: string, separators: RegExp): string | undefined {
  const groups = text.split(separators);
  if (groups.length === 1) return /^\d+$/u.test(text) ? text : undefined;
  const [head = "", ...tail] = groups;
  return /^[1-9]\d{0,2}$/u.test(head) && tail.every((group) => /^\d{3}$/u.test(group)) ? groups.join("") : undefined;
}

function readings(digits: string, negative: boolean): string[] {
  const marks = [...digits].filter((char) => char === "," || char === ".");
  const kinds = [...new Set(marks)];
  const spaces = /['  ]/u;
  if (kinds.length === 0) {
    const integer = groupedDigits(digits, spaces);
    return integer === undefined ? [] : [canonical(integer, "", negative)];
  }
  if (kinds.length === 2) {
    const decimal = digits.lastIndexOf(",") > digits.lastIndexOf(".") ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const [integerPart = "", fraction = "", ...rest] = digits.split(decimal);
    const integer = groupedDigits(integerPart, new RegExp(`['\\u00A0\\u202F${grouping === "." ? "\\." : ","}]`, "u"));
    return rest.length > 0 || integer === undefined || !/^\d+$/u.test(fraction) ? [] : [canonical(integer, fraction, negative)];
  }
  const mark = kinds[0] === "," ? "," : ".";
  const pieces = digits.split(mark);
  const asGroups = groupedDigits(digits, new RegExp(`['\\u00A0\\u202F${mark === "." ? "\\." : ","}]`, "u"));
  if (pieces.length > 2) return asGroups === undefined ? [] : [canonical(asGroups, "", negative)];
  const [integerPart = "", fraction = ""] = pieces;
  const integer = groupedDigits(integerPart, spaces);
  return [
    ...(integer !== undefined && /^\d+$/u.test(fraction) ? [canonical(integer, fraction, negative)] : []),
    ...(fraction.length === 3 && asGroups !== undefined ? [canonical(asGroups, "", negative)] : []),
  ];
}

function signAt(text: string, index: number): boolean {
  const char = text[index];
  if (char === undefined || !SIGNS.has(char)) return false;
  const before = text[index - 1];
  return before === undefined || /\s/u.test(before) || before === "(" || CURRENCY.test(before);
}

function numbersIn(raw: string): Set<string> {
  const text = normalizeForm(raw, true);
  const found = new Set<string>();
  for (const match of text.matchAll(/\d[\d.,'  ]*/gu)) {
    const digits = match[0].replace(/[.,'  ]+$/u, "");
    let start = match.index;
    const digitsEnd = start + digits.length;
    let negative = false;
    if (signAt(text, start - 1)) {
      negative = text[start - 1] !== "+";
      start -= 1;
    } else {
      let before = start;
      while (text[before - 1] === " ") before -= 1;
      if (CURRENCY.test(text[before - 1] ?? "")) {
        start = before - 1;
        if (signAt(text, start - 1)) {
          negative = text[start - 1] !== "+";
          start -= 1;
        }
      }
    }
    let end = digitsEnd;
    if (text[start - 1] === "(") {
      let close = digitsEnd;
      while (text[close] === " ") close += 1;
      if (CURRENCY.test(text[close] ?? "")) close += 1;
      while (text[close] === " ") close += 1;
      if (text[close] === ")") {
        negative = true;
        start -= 1;
        end = close + 1;
      }
    }
    if (!clearBefore(text, start, isDigit(text[start])) || !clearAfter(text, end, isDigit(text[end - 1]))) continue;
    for (const reading of readings(digits, negative)) found.add(reading);
  }
  return found;
}

function matchNumber(value: number, lines: readonly SourceLine[]): LineSourceId[] | undefined {
  const wanted = String(value);
  if (!Number.isFinite(value) || /e/iu.test(wanted)) return undefined;
  const line = lines.find((candidate) => numbersIn(candidate.text).has(wanted));
  return line === undefined ? undefined : [line.id];
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthNumber(name: string): number | undefined {
  const lower = name.toLowerCase();
  const index = MONTHS.findIndex((month) => month === lower || (lower.length === 3 && month.startsWith(lower)));
  return index < 0 ? undefined : index + 1;
}

function isoDay(year: number, month: number, day: number): string | undefined {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const START = String.raw`(?<![\p{L}\p{N}]|[\p{L}\p{N}][.,'\/\-])`;
const STOP = String.raw`(?![\p{L}\p{N}]|[.,'\/\-][\p{L}\p{N}])`;
const ORDINAL = "(?:st|nd|rd|th)?";

const DATE_TOKENS: readonly [RegExp, (groups: readonly string[]) => readonly (readonly [number, number, number])[]][] = [
  [new RegExp(String.raw`${START}(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${STOP}`, "gu"),
    ([year, month, day]) => [[Number(year), Number(month), Number(day)]]],
  [new RegExp(String.raw`${START}(\d{1,2})[./-](\d{1,2})[./-](\d{4})${STOP}`, "gu"), ([first, second, year]) => {
    const a = Number(first);
    const b = Number(second);
    if (a === b || a > 12) return [[Number(year), b, a]];
    return b > 12 ? [[Number(year), a, b]] : [];
  }],
  [new RegExp(String.raw`${START}(\d{1,2})${ORDINAL}\s+(\p{L}+)\.?,?\s+(\d{4})${STOP}`, "gu"),
    ([day, month, year]) => [[Number(year), monthNumber(month ?? "") ?? 0, Number(day)]]],
  [new RegExp(String.raw`${START}(\p{L}+)\.?\s+(\d{1,2})${ORDINAL},?\s+(\d{4})${STOP}`, "gu"),
    ([month, day, year]) => [[Number(year), monthNumber(month ?? "") ?? 0, Number(day)]]],
  [new RegExp(String.raw`${START}(\d{1,2})-(\p{L}{3})\.?-(\d{4})${STOP}`, "gu"),
    ([day, month, year]) => [[Number(year), monthNumber(month ?? "") ?? 0, Number(day)]]],
];

function datesIn(raw: string): Set<string> {
  const text = normalizeForm(raw);
  const found = new Set<string>();
  for (const [pattern, read] of DATE_TOKENS) {
    for (const match of text.matchAll(pattern)) {
      for (const [year, month, day] of read(match.slice(1))) {
        const iso = isoDay(year, month, day);
        if (iso !== undefined) found.add(iso);
      }
    }
  }
  return found;
}

function matchDate(value: string, lines: readonly SourceLine[]): LineSourceId[] | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (isoDay(year ?? 0, month ?? 0, day ?? 0) !== value) return undefined;
  const line = lines.find((candidate) => datesIn(candidate.text).has(value));
  return line === undefined ? undefined : [line.id];
}

/**
 * The lines, in page and line order, that show `value`, or `undefined`. A string
 * may span lines that follow each other on one page; a number or a date is read
 * from one line. A boolean never shows.
 */
export function evidenceFor(value: unknown, lines: readonly SourceLine[]): LineSourceId[] | undefined {
  const ordered = inLineOrder(lines);
  if (typeof value === "number") return matchNumber(value, ordered);
  if (typeof value === "string") return matchString(value, ordered) ?? matchDate(value, ordered);
  return undefined;
}
