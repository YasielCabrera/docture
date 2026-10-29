import type { DocumentElement, TableElement } from "docture";

interface CheckBase {
  /** Stable id, unique within one call. Results keep it. */
  readonly id: string;
  /** Compare without letter case. Default `false`. */
  readonly ignoreCase?: boolean;
}

/** `text` occurs inside one unit: an element's text, a list item or a table cell. */
export interface PresentCheck extends CheckBase {
  readonly kind: "present";
  readonly text: string;
  /** Exact number of occurrences. Default: at least one. */
  readonly count?: number;
  /** The page whose elements hold the match. A continued table or paragraph belongs to its first page. */
  readonly page?: number;
  /** Every page the matching unit's provenance covers, ascending. A table cell covers its row's page. */
  readonly sourcePages?: readonly number[];
  /** Only units of this element kind. */
  readonly element?: DocumentElement["kind"];
}

/** `text` occurs in no unit, so it also catches two units falsely joined into one. */
export interface AbsentCheck extends CheckBase {
  readonly kind: "absent";
  readonly text: string;
  readonly page?: number;
  readonly element?: DocumentElement["kind"];
}

/** The first occurrence of `before` starts before the first occurrence of `after`. */
export interface OrderCheck extends CheckBase {
  readonly kind: "order";
  readonly before: string;
  readonly after: string;
}

/**
 * A table cell whose whole text is `cell`, and its neighbours. `null` means the
 * table edge. Neighbours read through merged cells to the cell that covers the slot.
 */
export interface TableCheck extends CheckBase {
  readonly kind: "table";
  readonly cell: string;
  /** Only tables whose first row has exactly these cells. Tells similar tables apart. */
  readonly header?: readonly string[];
  readonly left?: string | null;
  readonly right?: string | null;
  readonly up?: string | null;
  readonly down?: string | null;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  /** The page whose elements hold the table. */
  readonly page?: number;
  /** The page the cell's row came from, read from `rowProvenance`. */
  readonly sourcePage?: number;
}

export type ConversionCheck = PresentCheck | AbsentCheck | OrderCheck | TableCheck;
/** The family of a check: `present`, `absent`, `order` or `table`. */
export type ConversionCheckKind = ConversionCheck["kind"];

/** One check's verdict, with the reason when it failed. */
export type ConversionCheckResult =
  | { readonly id: string; readonly kind: ConversionCheckKind; readonly pass: true }
  | { readonly id: string; readonly kind: ConversionCheckKind; readonly pass: false; readonly reason: string };

/** Every check's verdict and the pass and fail counts. */
export interface ConversionReport {
  readonly pass: boolean;
  readonly passed: number;
  readonly failed: number;
  /** One result per check, in check order. */
  readonly results: readonly ConversionCheckResult[];
}

/** What the checks read. `ConversionResult`, `DoctureDocument` and `LayoutDocument` all fit. */
export interface ConvertedPages {
  readonly pages: readonly {
    readonly pageNumber: number;
    readonly elements: readonly DocumentElement[];
  }[];
}

interface Unit {
  readonly text: string;
  readonly page?: number;
  readonly sourcePages?: readonly number[];
  readonly element?: DocumentElement["kind"];
}

interface Location {
  readonly page: number;
  readonly table: TableElement;
}

const normalize = (text: string, ignoreCase = false): string => {
  const value = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return ignoreCase ? value.toLowerCase() : value;
};

const quote = (text: string): string => JSON.stringify(text);
const NEEDS_DOCUMENT = "need a converted document, not a string";

function pagesOf(element: DocumentElement): readonly number[] {
  const { pageNumber, continuations = [] } = element.provenance;
  return [...new Set([pageNumber, ...continuations.map((segment) => segment.pageNumber)])].sort((a, b) => a - b);
}

function rowPage(table: TableElement, row: number): number | undefined {
  const provenance = table.rowProvenance?.[row];
  if (provenance !== undefined) return provenance.pageNumber;
  return table.provenance.continuations === undefined ? table.provenance.pageNumber : undefined;
}

function elementUnits(element: DocumentElement, page: number): Unit[] {
  const unit = (text: string, sourcePages = pagesOf(element)): Unit => ({ text, page, sourcePages, element: element.kind });
  switch (element.kind) {
    case "heading":
    case "paragraph":
    case "code":
    case "page-header":
    case "page-footer":
      return [unit(element.text)];
    case "list":
      return element.items.map((item) => unit(item.text));
    case "table":
      return element.rows.flatMap((cells, row) => {
        const source = rowPage(element, row);
        return cells.filter((cell) => cell !== "").map((cell) => unit(cell, source === undefined ? [] : [source]));
      });
    case "figure":
      return element.caption === undefined ? [] : [unit(element.caption)];
    case "page-break":
      return [];
  }
}

function unitsOf(output: string | ConvertedPages): readonly Unit[] {
  if (typeof output === "string") return output.split(/\n[^\S\n]*\n/u).map((text) => ({ text }));
  return output.pages.flatMap((page) => page.elements.flatMap((element) => elementUnits(element, page.pageNumber)));
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

function scope(check: { readonly page?: number; readonly element?: string }): string {
  return `${check.element === undefined ? "" : ` in a ${check.element}`}${check.page === undefined ? "" : ` on page ${check.page}`}`;
}

const times = (count: number): string => `${count} ${count === 1 ? "time" : "times"}`;

function inScope(units: readonly Unit[], check: PresentCheck | AbsentCheck): readonly Unit[] {
  return units.filter((unit) =>
    (check.page === undefined || unit.page === check.page) && (check.element === undefined || unit.element === check.element));
}

function checkPresent(check: PresentCheck, units: readonly Unit[], document: boolean): string | undefined {
  if (!document && (check.page !== undefined || check.sourcePages !== undefined || check.element !== undefined)) {
    return `page, sourcePages and element ${NEEDS_DOCUMENT}`;
  }
  const needle = normalize(check.text, check.ignoreCase);
  const matches = inScope(units, check)
    .map((unit) => ({ unit, count: occurrences(normalize(unit.text, check.ignoreCase), needle).length }))
    .filter((match) => match.count > 0);
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (check.count !== undefined && total !== check.count) {
    return `${quote(check.text)} found ${times(total)}${scope(check)}, expected ${check.count}`;
  }
  if (total === 0 && check.count === undefined) return `${quote(check.text)} not found${scope(check)}`;
  const expected = check.sourcePages?.join(", ");
  const wrong = expected === undefined ? undefined : matches.find((match) => match.unit.sourcePages?.join(", ") !== expected);
  if (wrong !== undefined) {
    const actual = wrong.unit.sourcePages?.length ? `pages ${wrong.unit.sourcePages.join(", ")}` : "no page";
    return `${quote(check.text)} comes from ${actual}, expected pages ${expected}`;
  }
  return undefined;
}

function checkAbsent(check: AbsentCheck, units: readonly Unit[], document: boolean): string | undefined {
  if (!document && (check.page !== undefined || check.element !== undefined)) return `page and element ${NEEDS_DOCUMENT}`;
  const needle = normalize(check.text, check.ignoreCase);
  const matches = inScope(units, check)
    .map((unit) => ({ unit, count: occurrences(normalize(unit.text, check.ignoreCase), needle).length }))
    .filter((match) => match.count > 0);
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total === 0) return undefined;
  const first = matches[0]?.unit.page;
  return `${quote(check.text)} found ${times(total)}${scope(check)}${first === undefined || check.page !== undefined ? "" : `, first on page ${first}`}`;
}

function firstPosition(units: readonly Unit[], text: string, ignoreCase: boolean | undefined): readonly [number, number] | undefined {
  const needle = normalize(text, ignoreCase);
  for (const [index, unit] of units.entries()) {
    const at = normalize(unit.text, ignoreCase).indexOf(needle);
    if (at >= 0) return [index, at];
  }
  return undefined;
}

function checkOrder(check: OrderCheck, units: readonly Unit[]): string | undefined {
  const before = firstPosition(units, check.before, check.ignoreCase);
  const after = firstPosition(units, check.after, check.ignoreCase);
  if (before === undefined) return `${quote(check.before)} not found`;
  if (after === undefined) return `${quote(check.after)} not found`;
  const precedes = before[0] < after[0] || (before[0] === after[0] && before[1] < after[1]);
  return precedes ? undefined : `${quote(check.before)} appears after ${quote(check.after)}`;
}

function tablesOf(output: ConvertedPages): Location[] {
  return output.pages.flatMap((page) => page.elements
    .filter((element): element is TableElement => element.kind === "table")
    .map((table) => ({ page: page.pageNumber, table })));
}

function anchorAt(table: TableElement, row: number, col: number): readonly [number, number] | undefined {
  if (row < 0 || col < 0 || row >= table.rows.length || col >= (table.rows[row]?.length ?? 0)) return undefined;
  const span = table.spans?.find((item) =>
    row >= item.row && row < item.row + item.rowSpan && col >= item.col && col < item.col + item.colSpan);
  return span === undefined ? [row, col] : [span.row, span.col];
}

function checkTableCell(check: TableCheck, { page, table }: Location, row: number, col: number): string[] {
  const span = table.spans?.find((item) => item.row === row && item.col === col);
  const colSpan = span?.colSpan ?? 1;
  const rowSpan = span?.rowSpan ?? 1;
  const textAt = (r: number, c: number): string | null => {
    const anchor = anchorAt(table, r, c);
    return anchor === undefined ? null : table.rows[anchor[0]]?.[anchor[1]] ?? null;
  };
  const neighbours = [
    ["left", check.left, textAt(row, col - 1)],
    ["right", check.right, textAt(row, col + colSpan)],
    ["up", check.up, textAt(row - 1, col)],
    ["down", check.down, textAt(row + rowSpan, col)],
  ] as const;
  const show = (value: string | null): string => (value === null ? "the table edge" : quote(value));
  const problems: string[] = [];
  for (const [side, expected, actual] of neighbours) {
    if (expected === undefined) continue;
    const same = expected === null || actual === null
      ? expected === actual
      : normalize(expected, check.ignoreCase) === normalize(actual, check.ignoreCase);
    if (!same) problems.push(`${side} is ${show(actual)}, expected ${show(expected)}`);
  }
  if (check.colSpan !== undefined && colSpan !== check.colSpan) problems.push(`colSpan is ${colSpan}, expected ${check.colSpan}`);
  if (check.rowSpan !== undefined && rowSpan !== check.rowSpan) problems.push(`rowSpan is ${rowSpan}, expected ${check.rowSpan}`);
  if (check.page !== undefined && page !== check.page) problems.push(`table is on page ${page}, expected ${check.page}`);
  if (check.sourcePage !== undefined) {
    const source = rowPage(table, row);
    if (source !== check.sourcePage) {
      problems.push(`row comes from ${source === undefined ? "an unknown page" : `page ${source}`}, expected ${check.sourcePage}`);
    }
  }
  return problems;
}

function checkTable(check: TableCheck, output: ConvertedPages): string | undefined {
  const cell = normalize(check.cell, check.ignoreCase);
  const header = check.header?.map((text) => normalize(text, check.ignoreCase));
  const candidates = tablesOf(output)
    .filter(({ table }) => {
      const first = table.rows[0]?.map((text) => normalize(text, check.ignoreCase));
      return header === undefined || (first !== undefined && first.length === header.length && first.every((text, index) => text === header[index]));
    })
    .flatMap((location) => location.table.rows.flatMap((cells, row) => cells.flatMap((text, col) => {
      const anchor = anchorAt(location.table, row, col);
      const own = anchor?.[0] === row && anchor[1] === col;
      return own && normalize(text, check.ignoreCase) === cell ? [checkTableCell(check, location, row, col)] : [];
    })));
  const label = `cell ${quote(check.cell)}${header === undefined ? "" : ` under header ${check.header?.map(quote).join(", ")}`}`;
  if (candidates.length === 0) return `${label} not found in a table`;
  if (candidates.some((problems) => problems.length === 0)) return undefined;
  const count = candidates.length === 1 ? "" : ` (${candidates.length} matches, none fits)`;
  return `${label}${count}: ${candidates[0]?.join("; ")}`;
}

function validate(checks: readonly ConversionCheck[]): void {
  const ids = new Set<string>();
  const positive = (value: number | undefined, name: string, id: string): void => {
    if (value !== undefined && !(Number.isInteger(value) && value >= 1)) throw new RangeError(`Check ${quote(id)}: ${name} must be a positive integer.`);
  };
  for (const check of checks) {
    if (check.id === "" || ids.has(check.id)) throw new RangeError(`Check ids must be unique and nonempty: ${quote(check.id)}.`);
    ids.add(check.id);
    const texts = check.kind === "order" ? [check.before, check.after] : check.kind === "table" ? [check.cell] : [check.text];
    if (texts.some((text) => normalize(text) === "")) throw new RangeError(`Check ${quote(check.id)} needs nonempty text.`);
    if (check.kind === "present" && check.count !== undefined && !(Number.isInteger(check.count) && check.count >= 0)) {
      throw new RangeError(`Check ${quote(check.id)}: count must be a nonnegative integer.`);
    }
    if (check.kind !== "order") positive(check.page, "page", check.id);
    if (check.kind === "present") for (const page of check.sourcePages ?? []) positive(page, "sourcePages", check.id);
    if (check.kind === "table") {
      positive(check.sourcePage, "sourcePage", check.id);
      positive(check.colSpan, "colSpan", check.id);
      positive(check.rowSpan, "rowSpan", check.id);
    }
  }
}

function reasonFor(check: ConversionCheck, output: string | ConvertedPages, units: readonly Unit[]): string | undefined {
  const document = typeof output !== "string";
  switch (check.kind) {
    case "present":
      return checkPresent(check, units, document);
    case "absent":
      return checkAbsent(check, units, document);
    case "order":
      return checkOrder(check, units);
    case "table":
      return document ? checkTable(check, output) : `table checks ${NEEDS_DOCUMENT}`;
    default:
      throw new RangeError(`Unknown check kind ${quote(String((check as { kind?: unknown }).kind))}.`);
  }
}

/**
 * Grade converted output against presence, absence, order and table checks.
 * Pass a converted document for page, provenance and table checks, or a Markdown
 * or text string for text checks only.
 *
 * Text is compared after Unicode NFKC normalization, with whitespace runs folded to
 * one space. A match never crosses a unit: one element's text, a list item or a
 * table cell, or for a string a block between blank lines.
 *
 * @example
 * ```ts
 * import { DocumentConverter } from "docture";
 * import { checkConversion } from "@docture/eval/conversion";
 *
 * const result = await new DocumentConverter().convert({ loaded }, { format: "json" });
 * const report = checkConversion(result, [
 *   { id: "total", kind: "table", cell: "Total", right: "60" },
 *   { id: "order", kind: "order", before: "Summary", after: "Appendix" },
 * ]);
 * console.log(report.results.filter((result) => !result.pass));
 * ```
 *
 * @throws {RangeError} When ids repeat, a text is empty, or a count, page or span is invalid.
 */
export function checkConversion(output: string | ConvertedPages, checks: readonly ConversionCheck[]): ConversionReport {
  validate(checks);
  const units = unitsOf(output);
  const results = checks.map((check): ConversionCheckResult => {
    const reason = reasonFor(check, output, units);
    return reason === undefined ? { id: check.id, kind: check.kind, pass: true } : { id: check.id, kind: check.kind, pass: false, reason };
  });
  const failed = results.filter((result) => !result.pass).length;
  return { pass: failed === 0, passed: results.length - failed, failed, results };
}
