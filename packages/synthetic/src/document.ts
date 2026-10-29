import type { LayoutBox } from "docture";
import type { TagValue } from "./template.js";

/** Where one printed field value sits. Points, top-left origin, the same convention as Docture's `LayoutBox`. */
export interface FieldLabel {
  /** Concrete path in `@docture/eval`'s format, such as `lineItems[3].amount`. */
  readonly path: string;
  /** The ground-truth value of this position. */
  readonly value: unknown;
  /** The text drawn for it. */
  readonly text: string;
  readonly pageNumber: number;
  readonly box: LayoutBox;
}

export interface PageInfo {
  readonly pageNumber: number;
  /** Points. */
  readonly width: number;
  readonly height: number;
}

/** How a rendition was produced from the digital original. */
export interface Rendition {
  /** `digital`, or the degradation profile key. */
  readonly kind: string;
  readonly severity?: number;
  readonly dpi?: number;
  /** Set for image renditions; absent for PDF. */
  readonly output?: "png" | "jpeg";
}

/** A rendered document with the ground truth it shows and where each value sits. */
export interface SyntheticDocument {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly pages: readonly PageInfo[];
  /** The sample with every unprinted position `null`. */
  readonly expected: unknown;
  readonly labels: readonly FieldLabel[];
  readonly sample: { readonly seed: number | string; readonly scenario: string; readonly tags: readonly string[] };
  readonly template: { readonly key: string; readonly family: string; readonly tags: Readonly<Record<string, TagValue>> };
  readonly rendition: Rendition;
  /** Inputs and engine versions that reproduce these bytes. */
  readonly provenance: Readonly<Record<string, unknown>>;
}

/** An `EvalCase` of `@docture/eval`, built without depending on it. */
export interface SyntheticCase {
  readonly id: string;
  readonly documents: readonly { readonly name: string; readonly mimeType: string; bytes(): Promise<Uint8Array>; readonly hash?: string }[];
  readonly expected: unknown;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly group: string;
  readonly locations: Readonly<Record<string, readonly { readonly pageNumber: number; readonly box: LayoutBox }[]>>;
}

const EXTENSIONS: Readonly<Record<string, string>> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** Labels grouped by path, the shape of `EvalCase.locations`. */
export function locationsOf(labels: readonly FieldLabel[]): SyntheticCase["locations"] {
  const out: Record<string, { pageNumber: number; box: LayoutBox }[]> = {};
  for (const label of labels) (out[label.path] ??= []).push({ pageNumber: label.pageNumber, box: label.box });
  return out;
}

/** The group key shared by every rendition of one rendering, so eval treats them as one ground truth. */
export function groupOf(document: SyntheticDocument): string {
  return `${document.sample.seed}:${document.sample.scenario}:${document.template.key}`;
}

/** The case id of a rendering's rendition. It reads only identity fields, so ids are known before rendering. */
export function caseIdOf(document: {
  readonly sample: Pick<SyntheticDocument["sample"], "seed" | "scenario">;
  readonly template: Pick<SyntheticDocument["template"], "key">;
  readonly rendition: Rendition;
}): string {
  const { kind, severity, dpi, output } = document.rendition;
  const suffix = `${severity === undefined ? "" : `-${severity}`}${dpi === undefined || dpi === 200 ? "" : `-${dpi}dpi`}${output === undefined ? "" : `-${output}`}`;
  return `${document.template.key}-${document.sample.scenario}-${document.sample.seed}-${kind}${suffix}`;
}

/** A case `@docture/eval` can score: tags and params slice by template, family, scenario and rendition. */
export function toEvalCase(document: SyntheticDocument, options: { readonly id?: string } = {}): SyntheticCase {
  const id = options.id ?? caseIdOf(document);
  const bytes = document.bytes;
  return {
    id,
    documents: [{ name: `${id}.${EXTENSIONS[document.mimeType] ?? "bin"}`, mimeType: document.mimeType, bytes: async () => bytes }],
    expected: document.expected,
    tags: {
      ...document.template.tags,
      template: document.template.key,
      family: document.template.family,
      scenario: document.sample.scenario,
      rendition: document.rendition.kind,
      ...(document.rendition.severity === undefined ? {} : { severity: severityBucket(document.rendition.severity) }),
    },
    params: { seed: document.sample.seed, scenarioTags: document.sample.tags, ...document.rendition },
    group: groupOf(document),
    locations: locationsOf(document.labels),
  };
}

export function severityBucket(severity: number): "mild" | "moderate" | "severe" {
  return severity < 0.4 ? "mild" : severity < 0.75 ? "moderate" : "severe";
}
