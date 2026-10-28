import { jsonSchema, type Schema } from "@ai-sdk/provider-utils";
import {
  sourceLines,
  type LoadedDocument,
  type LoadedPage,
  type OutcomeCitation,
} from "../core/index.js";
import { isPresent, pathKey, type FieldPath } from "../core/pipeline/citations.js";
import { evidenceFor, inLineOrder, normalizeText, type EvidenceLine } from "./evidence.js";
import { Origin, type OriginTree } from "./fold.js";
import type { PromptParts } from "./prompt.js";

/** Appended to the cache variant of every cited request. */
export const CITED_VARIANT = "+cited-v1";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function renderPage(page: LoadedPage): { readonly text: string; readonly lines: readonly EvidenceLine[] } {
  const lines = sourceLines(page)
    .map((line, index) => ({ ...line, spans: page.lines?.[index]?.spans ?? [] }))
    .filter((line) => line.text.trim() !== "");
  const native = (page.evidence ?? []).map((source) => ({ id: source.id, pageNumber: source.pageNumber, text: source.text, order: source.order, spans: [] }));
  const evidence: EvidenceLine[] = [...lines, ...native];
  if (evidence.length === 0) return { text: page.text, lines: evidence };
  return { text: evidence.map((line) => `[${line.id}] ${line.text.replace(/[\r\n]/gu, " ")}`).join("\n"), lines: evidence };
}

/**
 * The document as a cited request shows it, and the lines each page shows. Without
 * a single positioned line the document comes back untouched.
 */
export function withLineIds(document: LoadedDocument): {
  readonly document: LoadedDocument;
  readonly lines: ReadonlyMap<number, readonly EvidenceLine[]>;
} {
  const rendered = document.pages.map((page) => ({ page, ...renderPage(page) }));
  if (rendered.every(({ lines }) => lines.length === 0)) return { document, lines: new Map() };
  return {
    document: {
      ...document,
      pages: rendered.map(({ page, text }) => ({ ...page, text })),
      text: rendered.map(({ text }) => text).filter((text) => text.trim() !== "").join("\n\n"),
    },
    lines: new Map(rendered.map(({ page, lines }) => [page.pageNumber, lines])),
  };
}

const EXTRACT = "Extract the requested fields from the document below.";
const CITE = [
  "Each document line starts with its id in square brackets, such as [p1-line-1].",
  'Put the fields in "data". In "citations", add one entry for each value you return: "path" is the ' +
    "field's dotted path, with 0-based array indexes (lineItems.0.amount), and \"ids\" lists the ids of " +
    "the lines that show the value.",
  'Use only ids that appear in the document below. Leave a value out of "citations" when no line shows it.',
].join("\n");

export function citedPrompt(parts: PromptParts): PromptParts {
  const instructions = /\[p[1-9]\d*-(?:element|cell)-[a-f0-9]{12}\]/u.test(parts.prompt)
    ? CITE.replace("Each document line", "Each evidence record").replace("the lines that show", "the evidence records that show").replace("when no line shows it", "when no evidence record shows it") + "\nElement and cell IDs identify native blocks or table cells, never printed lines."
    : CITE;
  return { system: parts.system, prompt: parts.prompt.replace(EXTRACT, () => `${EXTRACT}\n${instructions}`) };
}

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"]);
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_VALUES = new Set([
  "additionalProperties", "items", "additionalItems", "contains", "not", "if", "then", "else",
  "propertyNames", "unevaluatedItems", "unevaluatedProperties",
]);

function refRebasedIntoWrapper(ref: string): string {
  if (ref === "#") return "#/$defs/__data";
  if (ref.startsWith("#/definitions/")) return `#/$defs/${ref.slice("#/definitions/".length)}`;
  if (ref.startsWith("#/$defs/")) return ref;
  if (ref.startsWith("#/")) return `#/$defs/__data${ref.slice(1)}`;
  return ref;
}

function withRefsRebasedIntoWrapper(schema: unknown): unknown {
  if (!isPlainObject(schema)) return structuredClone(schema);
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (key === "$ref" && typeof value === "string") return [key, refRebasedIntoWrapper(value)];
    if (SCHEMA_MAPS.has(key) && isPlainObject(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, withRefsRebasedIntoWrapper(child)]))];
    }
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) return [key, value.map(withRefsRebasedIntoWrapper)];
    if (SCHEMA_VALUES.has(key)) return [key, Array.isArray(value) ? value.map(withRefsRebasedIntoWrapper) : withRefsRebasedIntoWrapper(value)];
    return [key, structuredClone(value)];
  }));
}

/**
 * `{ data, citations }` around the data schema. The data schema moves to
 * `$defs.__data` and its own definitions to the wrapper's `$defs`, so recursive and
 * named schemas still resolve.
 */
export function citedJsonSchema(data: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, $id: _id, $defs, definitions, ...root } = data;
  const hoisted = (defs: unknown) => isPlainObject(defs)
    ? Object.fromEntries(Object.entries(defs).map(([name, child]) => [name, withRefsRebasedIntoWrapper(child)]))
    : {};
  return {
    type: "object",
    additionalProperties: false,
    required: ["data", "citations"],
    properties: {
      data: { $ref: "#/$defs/__data" },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "ids"],
          properties: { path: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
        },
      },
    },
    $defs: { ...hoisted(definitions), ...hoisted($defs), __data: withRefsRebasedIntoWrapper(root) },
  };
}

export interface CitedAnswer {
  /** `data` after the caller's validator, or as parsed when none ran. */
  readonly data: unknown;
  /** The parsed response, before any validator. The cache keeps this and validates it again on a hit. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * The wrapper schema. `validate` is the data schema's own validator, run on `data`
 * alone so its error, issues and repair seed match an uncited request; omit it for
 * a request over part of the document, where `data` may be missing.
 */
export function citedSchema(
  json: Record<string, unknown>,
  validate: Schema<unknown>["validate"],
  strict: boolean,
): Schema<CitedAnswer> {
  return jsonSchema<CitedAnswer>(json as Record<string, never>, {
    async validate(value) {
      if (!isPlainObject(value)) {
        return { success: false, error: new TypeError('The answer must be an object with "data" and "citations".') };
      }
      if (!strict) return { success: true, value: { data: value.data ?? null, raw: value } };
      if (!("data" in value)) return { success: false, error: new TypeError('The answer has no "data".') };
      if (validate === undefined) return { success: true, value: { data: value.data, raw: value } };
      const result = await validate(value.data);
      return result.success ? { success: true, value: { data: result.value, raw: value } } : result;
    },
  });
}

interface RawCitation {
  readonly path: string;
  readonly ids: readonly string[];
}

function parseCitations(value: unknown): RawCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => isPlainObject(entry) && typeof entry.path === "string" &&
    Array.isArray(entry.ids) && entry.ids.every((id: unknown) => typeof id === "string")
    ? [{ path: entry.path, ids: entry.ids as string[] }]
    : []);
}

function leafPath(data: unknown, segments: readonly string[]): FieldPath | undefined {
  let current = data;
  const path: (string | number)[] = [];
  for (const segment of segments) {
    if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/u.test(segment) && Number(segment) < current.length) {
      path.push(Number(segment));
      current = current[Number(segment)];
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      path.push(segment);
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return isPresent(current) && !Array.isArray(current) && !isPlainObject(current) ? path : undefined;
}

function resolvePath(data: unknown, path: string): FieldPath | undefined {
  const dotted = path.replace(/\[(\d+)\]/gu, ".$1").replace(/^\./u, "");
  return leafPath(data, dotted.split(".")) ??
    (dotted.startsWith("data.") ? leafPath(data, dotted.slice("data.".length).split(".")) : undefined);
}

function valueAt(data: unknown, path: FieldPath): unknown {
  let current = data;
  for (const segment of path) current = (current as Record<string | number, unknown> | undefined)?.[segment];
  return current;
}

/**
 * Check what one request's model cited against the lines that request showed.
 * `raw` is the model's `data` before any validator; `lines` are the lines the
 * request rendered, so an id it never showed is not evidence.
 */
export function verifyCitations(raw: unknown, citations: unknown, lines: readonly EvidenceLine[]): OutcomeCitation[] {
  const known = new Map<string, EvidenceLine>(lines.map((line) => [line.id, line]));
  const cited = new Map<string, { path: FieldPath; ids: string[] }>();
  for (const entry of parseCitations(citations)) {
    const path = resolvePath(raw, entry.path);
    if (path === undefined) continue;
    const field = cited.get(pathKey(path)) ?? { path, ids: [] };
    for (const id of entry.ids) if (!field.ids.includes(id)) field.ids.push(id);
    cited.set(pathKey(path), field);
  }
  return [...cited.values()].flatMap(({ path, ids }): OutcomeCitation[] => {
    if (ids.length === 0) return [];
    const value = valueAt(raw, path);
    const shown = ids.flatMap((id) => known.get(id) ?? []);
    const evidence = shown.length === 0 ? undefined : evidenceFor(value, inLineOrder(shown));
    return evidence === undefined
      ? [{ path, status: "cited-unverified", ids: shown.map((line) => line.id), value }]
      : [{ path, status: "verified", ids: evidence.ids, value, ...(evidence.spans === undefined ? {} : { spans: evidence.spans }) }];
  });
}

function citationIndex(citations: readonly OutcomeCitation[]): Map<string, OutcomeCitation> {
  return new Map(citations.map((citation) => [pathKey(citation.path), citation]));
}

const STATUS_RANK = { verified: 2, "cited-unverified": 1 } as const;

/** Ranks origins for the merge: verified, then cited-unverified, then uncited. */
export function citationRank(parts: readonly (readonly OutcomeCitation[])[]): (origin: Origin) => number {
  const indexes = parts.map(citationIndex);
  return (origin) => {
    const citation = indexes[origin.part]?.get(pathKey(origin.path));
    return citation === undefined ? 0 : STATUS_RANK[citation.status];
  };
}

/** Each merged leaf takes the citation its value came with, at its merged path. */
export function rebaseCitations(
  origins: OriginTree | undefined,
  parts: readonly (readonly OutcomeCitation[])[],
): OutcomeCitation[] {
  const indexes = parts.map(citationIndex);
  const rebased: OutcomeCitation[] = [];
  const walk = (tree: OriginTree, path: FieldPath): void => {
    if (tree instanceof Origin) {
      const citation = indexes[tree.part]?.get(pathKey(tree.path));
      if (citation !== undefined) rebased.push({ ...citation, path });
    } else if (Array.isArray(tree)) {
      tree.forEach((child: OriginTree, index) => walk(child, [...path, index]));
    } else {
      for (const [key, child] of Object.entries(tree)) walk(child, [...path, key]);
    }
  };
  if (origins !== undefined) walk(origins, []);
  return rebased;
}

function sameValue(first: unknown, second: unknown): boolean {
  if (typeof first === "string" && typeof second === "string") return normalizeText(first) === normalizeText(second);
  return first === second;
}

function sameTree(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((item, index) => sameTree(item, second[index]));
  }
  if (isPlainObject(first) && isPlainObject(second)) {
    const keys = Object.keys(first);
    return keys.length === Object.keys(second).length &&
      keys.every((key) => Object.hasOwn(second, key) && sameTree(first[key], second[key]));
  }
  return first === second;
}

/**
 * A repair of a merged answer resends no document, so its model cannot cite. A leaf
 * keeps its previous citation while its value is unchanged, and, inside an array,
 * only while the whole outermost array is unchanged.
 */
export function inheritCitations(
  previous: unknown,
  repaired: unknown,
  citations: readonly OutcomeCitation[],
): OutcomeCitation[] {
  return citations.filter((citation) => {
    if (!sameValue(valueAt(previous, citation.path), valueAt(repaired, citation.path))) return false;
    let container = previous;
    for (const [index, segment] of citation.path.entries()) {
      if (Array.isArray(container)) {
        const prefix = citation.path.slice(0, index);
        return sameTree(valueAt(previous, prefix), valueAt(repaired, prefix));
      }
      container = (container as Record<string | number, unknown>)[segment];
    }
    return true;
  });
}
