import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  isLineSourceId,
  isEvidenceSourceId,
  parseSourceEvidence,
  parseDoctureDocument,
  type FieldCitation,
  type LayoutPage,
  type LineSourceId,
  type EvidenceSourceId,
  type SourceEvidence,
  type SourceLine,
} from "docture";
import { numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError } from "../cli/errors.js";
import { expandInputs, type Input } from "../inputs.js";

export type ReviewRequest =
  | { readonly kind: "convert"; readonly source: Input }
  | { readonly kind: "saved-conversion"; readonly conversion: string; readonly source: Input }
  | { readonly kind: "extract"; readonly source: Input }
  | {
      readonly kind: "saved-extraction";
      readonly extraction: string;
      readonly source: Input;
      readonly item?: number;
    };

/** One extraction result as the review shows it. Citations and their lines arrive together or not at all. */
export interface ReviewedExtraction {
  readonly data: unknown;
  readonly sourceIdentity?: { readonly physicalSourceDigest?: string; readonly json: string };
  readonly binarySource?: { readonly digest: string; readonly provenanceJson: string };
  readonly textSource?: {
    readonly text: string;
    readonly digest: string;
    readonly label: string;
    readonly provenanceJson: string;
  };
  readonly cited?: { readonly citations: readonly FieldCitation[]; readonly sources: readonly SourceLine[]; readonly evidenceSources?: readonly SourceEvidence[] };
}

async function oneInput(value: string, cwd: string, flag: string): Promise<Input> {
  const inputs = await expandInputs([value], cwd);
  const [input] = inputs;
  if (input === undefined || inputs.length > 1) {
    throw new UsageError(`${flag} matched ${inputs.length} files; review takes one document.`);
  }
  return input;
}

export async function reviewRequest(parsed: Parsed, cwd: string): Promise<ReviewRequest> {
  const file = parsed.positionals[0];
  const conversion = stringFlag(parsed, "conversion");
  const extraction = stringFlag(parsed, "extraction");
  const source = stringFlag(parsed, "source");
  const item = numberFlag(parsed, "item", { min: 0, integer: true });
  const extracting = stringFlag(parsed, "schema") !== undefined || stringFlag(parsed, "model") !== undefined;

  if (conversion !== undefined && extraction !== undefined) {
    throw new UsageError("Pass either --conversion or --extraction, not both.");
  }
  if (item !== undefined && extraction === undefined) {
    throw new UsageError("--item applies only to --extraction.", "It picks one result from a saved batch envelope.");
  }
  const saved = conversion === undefined ? extraction : conversion;
  const savedFlag = conversion === undefined ? "--extraction" : "--conversion";
  if (saved !== undefined) {
    if (file !== undefined) {
      throw new UsageError(`Pass either a document to review or ${savedFlag} with --source, not both.`);
    }
    if (source === undefined) {
      throw new UsageError(
        `${savedFlag} needs --source <file>, the document it was made from.`,
        "A saved file holds boxes but no page images, so the pages are rendered from the source.",
      );
    }
    if (extracting) {
      throw new UsageError(`--schema and --model extract a new result; they do not apply to ${savedFlag}.`);
    }
    const input = await oneInput(source, cwd, "--source");
    return conversion === undefined
      ? { kind: "saved-extraction", extraction: resolve(cwd, saved), source: input, ...(item === undefined ? {} : { item }) }
      : { kind: "saved-conversion", conversion: resolve(cwd, saved), source: input };
  }

  if (file === undefined) {
    throw new UsageError(
      "Pass the document to review, or --conversion or --extraction with --source.",
      "docture review report.pdf, or docture review --conversion report.json --source report.pdf",
    );
  }
  if (source !== undefined) {
    throw new UsageError("--source applies only with --conversion or --extraction.");
  }
  const input = await oneInput(file, cwd, `"${file}"`);
  return extracting ? { kind: "extract", source: input } : { kind: "convert", source: input };
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`"${path}" is not JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

interface Issue {
  readonly path: string;
  readonly message: string;
}

function invalid(path: string, what: string, issues: readonly Issue[]): UsageError {
  const shown = issues.slice(0, 5).map((issue) => `${issue.path === "" ? "(root)" : issue.path}: ${issue.message}`);
  const more = issues.length > shown.length ? `; and ${issues.length - shown.length} more` : "";
  return new UsageError(`"${path}" is not ${what}: ${shown.join("; ")}${more}.`);
}

/** Version 1 and 2 snapshots from `convert --to json`, as version 2 pages. */
export function parseSavedConversion(text: string, path: string): readonly LayoutPage[] {
  return parseSavedConversionRecord(text, path).pages;
}

export function parseSavedConversionRecord(text: string, path: string): { readonly pages: readonly LayoutPage[]; readonly physicalSourceDigest?: string } {
  const parsed = parseDoctureDocument(parseJson(text, path));
  if (!parsed.ok) throw invalid(path, "a docture conversion snapshot", parsed.issues);
  return { pages: parsed.document.pages, ...(parsed.document.physicalSourceDigest === undefined ? {} : { physicalSourceDigest: parsed.document.physicalSourceDigest }) };
}

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

const isBox = (value: unknown): boolean =>
  isObject(value) &&
  ["x", "y", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
  (value["width"] as number) >= 0 &&
  (value["height"] as number) >= 0;

function evidenceIds(value: unknown): readonly EvidenceSourceId[] | undefined {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && isEvidenceSourceId(id))
    ? (value as EvidenceSourceId[])
    : undefined;
}

function sourcesOf(value: unknown, issues: Issue[]): readonly SourceLine[] {
  if (!Array.isArray(value)) {
    issues.push({ path: "citationSources", message: "must be an array" });
    return [];
  }
  value.forEach((line: unknown, index) => {
    const at = `citationSources.${index}`;
    if (!isObject(line)) return issues.push({ path: at, message: "must be an object" });
    if (typeof line["id"] !== "string" || !isLineSourceId(line["id"])) issues.push({ path: `${at}.id`, message: "must be a line id such as p1-line-3" });
    if (!isCount(line["pageNumber"])) issues.push({ path: `${at}.pageNumber`, message: "must be an integer from 1" });
    if (!isBox(line["box"])) issues.push({ path: `${at}.box`, message: "must be { x, y, width, height } in points" });
    if (typeof line["text"] !== "string") issues.push({ path: `${at}.text`, message: "must be a string" });
    return undefined;
  });
  return value as SourceLine[];
}

function citationsOf(value: unknown, known: ReadonlySet<string>, issues: Issue[]): readonly FieldCitation[] {
  if (!Array.isArray(value)) {
    issues.push({ path: "citations", message: "must be an array" });
    return [];
  }
  value.forEach((citation: unknown, index) => {
    const at = `citations.${index}`;
    if (!isObject(citation)) return issues.push({ path: at, message: "must be an object" });
    if (typeof citation["path"] !== "string") issues.push({ path: `${at}.path`, message: "must be a string" });
    const ids = evidenceIds(citation["ids"]);
    if (ids === undefined) return issues.push({ path: `${at}.ids`, message: "must be an array of canonical evidence ids" });
    const status = citation["status"];
    if (status !== "verified" && status !== "cited-unverified" && status !== "uncited") {
      issues.push({ path: `${at}.status`, message: "must be verified, cited-unverified, or uncited" });
    } else if (status === "verified" && ids.length === 0) {
      issues.push({ path: `${at}.ids`, message: "must name at least one line when verified" });
    } else if (status === "uncited" && ids.length > 0) {
      issues.push({ path: `${at}.ids`, message: "must be empty when uncited" });
    }
    ids.forEach((id, position) => {
      if (!known.has(id)) issues.push({ path: `${at}.ids.${position}`, message: `names ${id}, which ${isLineSourceId(id) ? "citationSources does" : "evidenceSources do"} not hold` });
    });
    const confidence = citation["minOcrConfidence"];
    if (confidence !== undefined && !(typeof confidence === "number" && confidence >= 0 && confidence <= 1)) {
      issues.push({ path: `${at}.minOcrConfidence`, message: "must be a number from 0 to 1" });
    }
    return undefined;
  });
  return value as FieldCitation[];
}

function textSourceOf(record: Json, path: string): ReviewedExtraction["textSource"] {
  if (!("sourceText" in record)) return undefined;
  const source = record["source"];
  if (typeof record["sourceText"] !== "string" || !isObject(source) || source["variant"] !== "content" || typeof source["digest"] !== "string" || !/^[a-f0-9]{64}$/u.test(source["digest"])) {
    throw invalid(path, "an extract result with valid stored content", [{ path: "source", message: "sourceText requires a content source descriptor with a SHA-256 digest" }]);
  }
  const digest = createHash("sha256").update(record["sourceText"], "utf8").digest("hex");
  if (source["digest"] !== digest) throw invalid(path, "an extract result with valid stored content", [{ path: "source.digest", message: "does not match the exact UTF-8 sourceText" }]);
  return { text: record["sourceText"], digest, label: typeof record["file"] === "string" ? record["file"] : "Stored content", provenanceJson: JSON.stringify(source, null, 2) };
}

function selectRecord(value: unknown, path: string, item: number | undefined): Json {
  if (isObject(value) && Array.isArray(value["results"])) {
    if (value["command"] !== "extract" && !(value["command"] === "paperless" && (value["action"] === "extract" || value["action"] === "plan"))) {
      throw new UsageError(`"${path}" is a ${String(value["command"])} envelope, not an extract result.`);
    }
    const results: readonly unknown[] = value["results"];
    if (results.length === 0) throw new UsageError(`"${path}" holds no results.`);
    if (item === undefined && results.length > 1) {
      throw new UsageError(
        `"${path}" holds ${results.length} results; choose one to review.`,
        `Pass --item <n>, from 0 to ${results.length - 1}.`,
      );
    }
    const index = item ?? 0;
    const selected = results[index];
    if (selected === undefined) {
      throw new UsageError(`--item ${index} is out of range: "${path}" holds ${results.length} results.`);
    }
    if (!isObject(selected)) throw invalid(path, "an extract result", [{ path: `results.${index}`, message: "must be an object" }]);
    return selected;
  }
  if (item !== undefined) {
    throw new UsageError(`--item picks from a batch envelope, and "${path}" holds a single result.`);
  }
  if (!isObject(value)) throw invalid(path, "an extract result", [{ path: "", message: "must be an object" }]);
  return value;
}

/**
 * A saved `extract --full` result: the JSON envelope, or one record from `--format
 * ndjson` or a per-file `--out`. An envelope with several results needs `item`.
 */
export function parseSavedExtraction(text: string, path: string, item?: number): ReviewedExtraction {
  const record = selectRecord(parseJson(text, path), path, item);
  if (record["ok"] === false) {
    const error = isObject(record["error"]) ? record["error"] : {};
    throw new UsageError(
      `The selected result for ${String(record["file"])} failed, so there is nothing to review: ${String(error["message"])}`,
    );
  }
  if (record["ok"] !== true || !("data" in record)) {
    throw invalid(path, "an extract result", [{ path: "", message: "must hold ok: true and data" }]);
  }
  const textSource = textSourceOf(record, path);
  if (isObject(record["source"]) && record["source"]["kind"] === "paperless" && record["source"]["variant"] === "content" && textSource === undefined) {
    throw invalid(path, "an extract result with valid stored content", [{ path: "sourceText", message: "a content source requires its exact saved text" }]);
  }
  const source = record["source"];
  let binarySource: ReviewedExtraction["binarySource"];
  if (isObject(source) && source["kind"] === "paperless" && source["variant"] !== "content") {
    if ((source["variant"] !== "archive" && source["variant"] !== "original") || typeof source["digest"] !== "string" || !/^[a-f0-9]{64}$/u.test(source["digest"])) {
      throw invalid(path, "an extract result", [{ path: "source", message: "Paperless binary sources require an archive/original variant and SHA-256 digest" }]);
    }
    binarySource = { digest: source["digest"], provenanceJson: JSON.stringify(source, null, 2) };
  }
  for (const key of ["sourceDigest", "physicalSourceDigest"] as const) {
    if (record[key] !== undefined && (typeof record[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record[key]))) throw invalid(path, "an extract result", [{ path: key, message: "must be a SHA-256 source identity" }]);
  }
  if (record["sourceMetadata"] !== undefined && !isObject(record["sourceMetadata"])) throw invalid(path, "an extract result", [{ path: "sourceMetadata", message: "must be an object" }]);
  const sourceIdentity = record["sourceDigest"] === undefined && record["physicalSourceDigest"] === undefined && record["sourceMetadata"] === undefined ? undefined : {
    ...(typeof record["physicalSourceDigest"] === "string" ? { physicalSourceDigest: record["physicalSourceDigest"] } : {}),
    json: JSON.stringify({ sourceDigest: record["sourceDigest"], physicalSourceDigest: record["physicalSourceDigest"], metadata: record["sourceMetadata"] }, null, 2),
  };
  const storedText = { ...(sourceIdentity === undefined ? {} : { sourceIdentity }), ...(textSource === undefined ? {} : { textSource }), ...(binarySource === undefined ? {} : { binarySource }) };
  const hasCitations = "citations" in record;
  if (hasCitations !== "citationSources" in record) {
    throw invalid(path, "an extract result", [{ path: hasCitations ? "citationSources" : "citations", message: "must be present with the other" }]);
  }
  if (!hasCitations) {
    if (textSource !== undefined && Array.isArray(record["evidenceSources"]) && record["evidenceSources"].length > 0) throw invalid(path, "an extract result with valid stored content", [{ path: "evidenceSources", message: "plain stored content cannot claim positioned or native source evidence" }]);
    return { data: record["data"], ...storedText };
  }

  const issues: Issue[] = [];
  const sources = sourcesOf(record["citationSources"], issues);
  const native: SourceEvidence[] = [];
  if (record["evidenceSources"] !== undefined) {
    if (!Array.isArray(record["evidenceSources"])) issues.push({ path: "evidenceSources", message: "must be an array" });
    else for (const [index, value] of record["evidenceSources"].entries()) {
      const parsed = parseSourceEvidence(value);
      if (parsed.ok) native.push(parsed.source);
      else issues.push(...parsed.issues.map((issue) => ({ path: `evidenceSources.${index}.${issue.path}`, message: issue.message })));
    }
    if (new Set(native.map((source) => source.id)).size !== native.length) issues.push({ path: "evidenceSources", message: "source IDs must be unique" });
  }
  const known = new Set<string>(sources.map((line) => (isObject(line) ? line["id"] : undefined)).filter((id) => typeof id === "string"));
  for (const source of native) known.add(source.id);
  const citations = citationsOf(record["citations"], known, issues);
  if (textSource !== undefined && (sources.length > 0 || native.length > 0)) issues.push({ path: "sourceText", message: "plain stored content cannot claim positioned or native source evidence" });
  if (issues.length > 0) throw invalid(path, "an extract result with valid citations", issues);
  return { data: record["data"], ...storedText, cited: { citations, sources, ...(record["evidenceSources"] === undefined ? {} : { evidenceSources: native }) } };
}
