import type { DocumentElement, DoctureDocument, ProvenanceSegment, TableElement } from "../domain/conversion.js";
import type { ValidationIssue } from "../domain/result.js";
import { DOCUMENT_SCHEMA_V1, DOCUMENT_SCHEMA_V2 } from "./document-schemas.js";
import { provenanceSegments } from "./provenance.js";
import { tableIssues } from "./tables.js";
import { isEvidenceSourceId, type SourceEvidence } from "../domain/evidence.js";

/** The JSON Schema subset `scripts/generate-document-schema.mjs` emits. */
export interface SchemaNode {
  readonly $schema?: string;
  readonly title?: string;
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly const?: string | number | boolean;
  readonly anyOf?: readonly SchemaNode[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: SchemaNode;
  readonly minItems?: number;
  readonly minimum?: number;
  readonly pattern?: string;
}

export type DoctureDocumentParse =
  | { readonly ok: true; readonly document: DoctureDocument; readonly sourceVersion: 1 | 2 }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

type Json = Readonly<Record<string, unknown>>;

export type SourceEvidenceParse =
  | { readonly ok: true; readonly source: SourceEvidence }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Validate a standalone native evidence record, such as a saved extraction source. */
export function parseSourceEvidence(value: unknown): SourceEvidenceParse {
  const schema = DOCUMENT_SCHEMA_V2.properties?.pages?.items?.properties?.evidence?.items;
  if (schema === undefined) throw new Error("The generated document schema has no native evidence definition.");
  const issues: ValidationIssue[] = [];
  check(schema, value, "", issues);
  if (issues.length > 0) return { ok: false, issues };
  const source = value as SourceEvidence;
  if (!isEvidenceSourceId(source.id) || !source.id.startsWith(`p${source.pageNumber}-`)) issues.push({ path: "id", message: "must be a canonical evidence id matching pageNumber" });
  if (!Number.isSafeInteger(source.pageNumber) || source.pageNumber < 1 || !Number.isSafeInteger(source.order) || source.order < 0) issues.push({ path: "pageNumber", message: "page and source order must be nonnegative safe integers, with page from 1" });
  if (source.location.kind === "unlocated") {
    if (source.location.pageNumbers.length === 0 || source.location.pageNumbers.some((number) => !Number.isSafeInteger(number) || number < 1) || new Set(source.location.pageNumbers).size !== source.location.pageNumbers.length) issues.push({ path: "location.pageNumbers", message: "must list distinct positive page numbers" });
  } else if (source.location.pageNumber !== source.pageNumber) issues.push({ path: "location.pageNumber", message: "must match the evidence page" });
  if (source.location.kind === "physical" && (!/^sha256:[a-f0-9]{64}$/u.test(source.location.sourceDigest) || Object.values(source.location.box).some((number) => !Number.isFinite(number) || number < 0))) issues.push({ path: "location", message: "physical evidence requires a bound SHA-256 and finite nonnegative box" });
  if (source.granularity === "table-cell" && (![source.row, source.column].every((number) => Number.isSafeInteger(number) && number >= 0) || ![source.rowSpan, source.colSpan].every((number) => Number.isSafeInteger(number) && number >= 1))) issues.push({ path: "row", message: "cell coordinates and spans must be safe integers" });
  return issues.length === 0 ? { ok: true, source } : { ok: false, issues };
}

const at = (path: string, key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function discriminated(node: SchemaNode, value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(node.properties ?? {}).every(([key, property]) =>
    property.const === undefined || value[key] === property.const);
}

function check(node: SchemaNode, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (node.anyOf !== undefined) {
    const results = node.anyOf.map((alternative) => {
      const found: ValidationIssue[] = [];
      check(alternative, value, path, found);
      return { alternative, found };
    });
    if (results.some(({ found }) => found.length === 0)) return;
    if (node.anyOf.every((alternative) => alternative.const !== undefined)) {
      issues.push({ path, message: `must be ${node.anyOf.map((alternative) => JSON.stringify(alternative.const)).join(" or ")}` });
      return;
    }
    const matching = results.filter(({ alternative }) => discriminated(alternative, value));
    if (matching.length === 1) issues.push(...(matching[0]?.found ?? []));
    else issues.push({ path, message: "does not match any allowed shape" });
    return;
  }
  if (node.const !== undefined) {
    if (value !== node.const) issues.push({ path, message: `must be ${JSON.stringify(node.const)}` });
    return;
  }
  switch (node.type) {
    case "object": {
      if (!isObject(value)) {
        issues.push({ path, message: "must be an object" });
        return;
      }
      const properties = node.properties ?? {};
      for (const [key, property] of Object.entries(properties)) {
        if (Object.hasOwn(value, key)) check(property, value[key], at(path, key), issues);
        else if (node.required?.includes(key) === true) issues.push({ path: at(path, key), message: "is required" });
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) issues.push({ path: at(path, key), message: "is not allowed" });
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        issues.push({ path, message: "must be an array" });
        return;
      }
      if (node.minItems !== undefined && value.length < node.minItems) {
        issues.push({ path, message: `must have at least ${node.minItems} item${node.minItems === 1 ? "" : "s"}` });
      }
      if (node.items !== undefined) {
        const items = node.items;
        value.forEach((item, index) => check(items, item, at(path, index), issues));
      }
      return;
    }
    case "string":
      if (typeof value !== "string") issues.push({ path, message: "must be a string" });
      else if (node.pattern !== undefined && !new RegExp(node.pattern, "u").test(value)) {
        issues.push({ path, message: `must match ${node.pattern}` });
      }
      return;
    case "number":
    case "integer":
      if (typeof value !== "number") issues.push({ path, message: "must be a number" });
      else if (node.type === "integer" && !Number.isInteger(value)) issues.push({ path, message: "must be an integer" });
      else if (node.minimum !== undefined && value < node.minimum) {
        issues.push({ path, message: `must be at least ${node.minimum}` });
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") issues.push({ path, message: "must be a boolean" });
      return;
    case undefined:
      return;
  }
}

function lineIdIssues(segment: ProvenanceSegment, path: string): ValidationIssue[] {
  const prefix = `p${segment.pageNumber}-line-`;
  return (segment.lineIds ?? []).flatMap((id, index) => id.startsWith(prefix)
    ? []
    : [{ path: `${path}.lineIds.${index}`, message: `must name a line on page ${segment.pageNumber}` }]);
}

function continuationIssues(document: DoctureDocument, pageIndex: number, element: DocumentElement, path: string): ValidationIssue[] {
  const continuations = element.provenance.continuations;
  if (continuations === undefined) return [];
  if (element.kind !== "table" && element.kind !== "paragraph") {
    return [{ path: `${path}.provenance.continuations`, message: "is allowed only on tables and paragraphs" }];
  }
  return continuations.flatMap((segment, index) => {
    const at = `${path}.provenance.continuations.${index}`;
    const previous = document.pages[pageIndex + index]?.pageNumber ?? 0;
    const expected = document.pages[pageIndex + index + 1]?.pageNumber;
    if (segment.pageNumber === expected) return lineIdIssues(segment, at);
    return [{
      path: `${at}.pageNumber`,
      message: expected === undefined ? `must not follow page ${previous}, the last page` : `must be ${expected}, the page after ${previous}`,
    }];
  });
}

function rowProvenanceIssues(table: TableElement, path: string): ValidationIssue[] {
  const rows = table.rowProvenance;
  if (rows === undefined) return [];
  if (rows.length !== table.rows.length) {
    return [{ path: `${path}.rowProvenance`, message: `must have ${table.rows.length} entries, one per row` }];
  }
  const pages = provenanceSegments(table.provenance).map((segment) => segment.pageNumber);
  return rows.flatMap((segment, index) => {
    const at = `${path}.rowProvenance.${index}`;
    const above = rows[index - 1]?.pageNumber ?? 0;
    if (!pages.includes(segment.pageNumber)) {
      return [{ path: `${at}.pageNumber`, message: `must be one of the table's pages ${pages.join(", ")}` }];
    }
    if (segment.pageNumber < above) {
      return [{ path: `${at}.pageNumber`, message: `must not be before page ${above} of the row above` }];
    }
    return lineIdIssues(segment, at);
  });
}

function crossFieldIssues(document: DoctureDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  document.pages.forEach((page, pageIndex) => {
    page.elements.forEach((element, elementIndex) => {
      const path = `pages.${pageIndex}.elements.${elementIndex}`;
      if (seen.has(element.id)) issues.push({ path: `${path}.id`, message: `duplicates element id "${element.id}"` });
      seen.add(element.id);
      const segment = element.provenance;
      if (segment.pageNumber !== page.pageNumber) {
        issues.push({
          path: `${path}.provenance.pageNumber`,
          message: `must equal the holding page number ${page.pageNumber}`,
        });
      }
      issues.push(...lineIdIssues(segment, `${path}.provenance`));
      const continuations = continuationIssues(document, pageIndex, element, path);
      issues.push(...continuations);
      if (element.kind === "table") {
        issues.push(...tableIssues(element, path));
        if (continuations.length === 0) issues.push(...rowProvenanceIssues(element, path));
      }
    });
  });
  const elements = new Map(document.pages.flatMap((page) => page.elements).map((element) => [element.id, element]));
  const evidenceIds = new Set<string>();
  const pageNumbers = new Set(document.pages.map((page) => page.pageNumber));
  document.pages.forEach((page, pageIndex) => (page.evidence ?? []).forEach((source, index) => {
    const path = `pages.${pageIndex}.evidence.${index}`;
    if (!isEvidenceSourceId(source.id) || evidenceIds.has(source.id)) issues.push({ path: `${path}.id`, message: "must be a unique canonical evidence id" });
    evidenceIds.add(source.id);
    if (source.pageNumber !== page.pageNumber || !source.id.startsWith(`p${page.pageNumber}-`)) issues.push({ path: `${path}.pageNumber`, message: "must match the evidence id and holding page" });
    if (!Number.isInteger(source.order) || source.order < 0) issues.push({ path: `${path}.order`, message: "must be a nonnegative integer" });
    const element = elements.get(source.elementId);
    if (element === undefined) issues.push({ path: `${path}.elementId`, message: "must name a normalized element" });
    if (source.location.kind === "unlocated") {
      if (source.location.pageNumbers.length === 0 || source.location.pageNumbers.some((number) => !pageNumbers.has(number)) || new Set(source.location.pageNumbers).size !== source.location.pageNumbers.length) issues.push({ path: `${path}.location.pageNumbers`, message: "must list distinct known pages" });
    } else if (source.location.pageNumber !== source.pageNumber) issues.push({ path: `${path}.location.pageNumber`, message: "must match the evidence page" });
    if (source.location.kind === "physical") {
      if (!/^sha256:[a-f0-9]{64}$/u.test(source.location.sourceDigest)) issues.push({ path: `${path}.location.sourceDigest`, message: "must identify the bound original bytes with SHA-256" });
      if (Object.values(source.location.box).some((value) => !Number.isFinite(value) || value < 0)) issues.push({ path: `${path}.location.box`, message: "must have finite nonnegative coordinates and dimensions" });
    }
    if (source.granularity === "table-cell" && (element?.kind !== "table" || !Number.isInteger(source.row) || !Number.isInteger(source.column) || source.row < 0 || source.column < 0 || !Number.isInteger(source.rowSpan) || !Number.isInteger(source.colSpan) || source.rowSpan < 1 || source.colSpan < 1 || source.row + source.rowSpan > element.rows.length || source.column + source.colSpan > (element.rows[0]?.length ?? 0))) issues.push({ path, message: "cell evidence must address a valid span in its table" });
  }));
  return issues;
}

/**
 * Validate untrusted conversion JSON, such as a saved `--to json` file. Version 1
 * and version 2 documents are accepted. A valid version 1 document is returned as
 * version 2, because version 1 is a structural subset; `sourceVersion` says which
 * one was read. Any other `schemaVersion` is one issue.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { parseDoctureDocument } from "docture";
 *
 * const parsed = parseDoctureDocument(JSON.parse(await readFile("report.json", "utf8")));
 * if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
 * console.log(parsed.sourceVersion, parsed.document.pages.length);
 * ```
 */
export function parseDoctureDocument(value: unknown): DoctureDocumentParse {
  if (!isObject(value)) return { ok: false, issues: [{ path: "", message: "must be an object" }] };
  const version = value["schemaVersion"];
  if (version !== 1 && version !== 2) return { ok: false, issues: [{ path: "schemaVersion", message: "must be 1 or 2" }] };
  const issues: ValidationIssue[] = [];
  check(version === 1 ? DOCUMENT_SCHEMA_V1 : DOCUMENT_SCHEMA_V2, value, "", issues);
  if (issues.length > 0) return { ok: false, issues };
  const document = (version === 1 ? { ...value, schemaVersion: 2 } : value) as unknown as DoctureDocument;
  const related = crossFieldIssues(document);
  return related.length > 0 ? { ok: false, issues: related } : { ok: true, document, sourceVersion: version };
}
