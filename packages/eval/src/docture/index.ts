import type { ContractLike, Extractor, ExtractionResult, InferContract } from "docture";
import { toUsage, type PricingTable } from "docture/llm/pricing";
import { DatasetError, PricedExtractionFailure } from "../errors.js";
import type { EvalExtractor, FieldEvidence } from "../extractor.js";
import type { JsonValue } from "../json.js";
import { formatPath } from "../path.js";

function concretePath(path: string, data: unknown): string {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === "`") quoted = !quoted;
    else if (quoted && char === "\\") {
      part += path[++i] ?? "";
    } else if (!quoted && char === ".") {
      parts.push(part);
      part = "";
    } else part += char;
  }
  if (path) parts.push(part);
  const segments: (string | number)[] = [];
  let value = data;
  for (const key of parts) {
    segments.push(Array.isArray(value) && /^\d+$/u.test(key) ? Number(key) : key);
    value = typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value))[key] : undefined;
  }
  return formatPath(segments);
}
/** Configure identity, expected method and cost accounting for a Docture extractor. */
export interface FromDoctureOptions {
  readonly id?: string;
  readonly config?: JsonValue;
  readonly expectedMethod?: string;
  readonly pricing?: PricingTable;
  /** Model id used to look up an explicit pricing table; Docture results do not contain a model id. */
  readonly modelId?: string;
}
/** Options with a projection from Docture's result to a comparable view other than the contract's data. */
export interface FromDoctureProjection<C extends ContractLike, T> extends FromDoctureOptions {
  /** Confidence and evidence are keyed by contract paths, which a projection can move, so they are dropped. */
  readonly project: (result: ExtractionResult<InferContract<C>>) => T;
}
type DoctureExtractor = Pick<Extractor, "extract" | "dispose">;

type DoctureUsage = Partial<ExtractionResult<unknown>["usage"]>;

const count = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

function costOf(usage: DoctureUsage, options: FromDoctureOptions): number | undefined {
  if (usage.costUsd !== undefined) return usage.costUsd;
  const raw = {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    inputTokenDetails: { cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens },
  };
  return toUsage(raw, usage.wallMs ?? 0, options.modelId, options.pricing).costUsd;
}

function priceFailure(error: unknown, options: FromDoctureOptions): unknown {
  if (typeof error !== "object" || error === null || !("usage" in error)) return error;
  const usage = error.usage;
  if (typeof usage !== "object" || usage === null || ("costUsd" in usage && usage.costUsd !== undefined)) return error;
  const tokens: Record<string, unknown> = Object.fromEntries(Object.entries(usage));
  const read: DoctureUsage = Object.fromEntries(
    (["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "wallMs"] as const).flatMap((key) => {
      const value = count(tokens[key]);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const costUsd = costOf(read, options);
  return costUsd === undefined ? error : new PricedExtractionFailure(error, { ...usage, costUsd });
}

function located(box: { readonly width: number; readonly height: number } | undefined): boolean {
  return box !== undefined && box.width > 0 && box.height > 0;
}

function evidenceOf<D>(result: ExtractionResult<D>): { confidence: Record<string, number>; evidence: FieldEvidence[] } {
  const confidence: Record<string, number> = {};
  const evidence: FieldEvidence[] = [];
  for (const citation of result.citations ?? []) {
    const path = concretePath(citation.path, result.data);
    const conf = "minOcrConfidence" in citation ? citation.minOcrConfidence : undefined;
    if (conf !== undefined) confidence[path] = conf;
    const common = { path, status: citation.status, ...(conf === undefined ? {} : { confidence: conf }) };
    for (const id of citation.ids) {
      const line = result.citationSources?.find((line) => line.id === id);
      if (line) {
        evidence.push({ ...common, pageNumber: line.pageNumber, ...(located(line.box) ? { box: line.box } : {}) });
        continue;
      }
      const source = result.evidenceSources?.find((source) => source.id === id);
      if (!source) continue;
      switch (source.location.kind) {
        case "physical":
          evidence.push({
            ...common,
            pageNumber: source.location.pageNumber,
            ...(located(source.location.box) ? { box: source.location.box } : {}),
          });
          break;
        case "logical":
          evidence.push({ ...common, pageNumber: source.location.pageNumber });
          break;
        case "unlocated":
          break;
      }
    }
  }
  return { confidence, evidence };
}

/**
 * Adapt a structural Docture extractor; each case must contain one non-empty document. Every Docture failure,
 * including `UnsupportedSourceError`, becomes an errored row: Docture has no signal for a document outside the
 * project's scope. Usage has no `calls`, because one Docture attempt can make several model calls and the
 * result does not count them. A failed extraction keeps the usage Docture attached to its error, priced like a
 * successful one when Docture set no cost.
 */
export function fromDocture<C extends ContractLike>(
  extractor: DoctureExtractor,
  contract: C,
  options?: FromDoctureOptions,
): EvalExtractor<ExtractionResult<InferContract<C>>, InferContract<C>>;
export function fromDocture<C extends ContractLike, T>(
  extractor: DoctureExtractor,
  contract: C,
  options: FromDoctureProjection<C, T>,
): EvalExtractor<ExtractionResult<InferContract<C>>, T>;
export function fromDocture<C extends ContractLike, T>(
  extractor: DoctureExtractor,
  contract: C,
  options: FromDoctureOptions & { readonly project?: (result: ExtractionResult<InferContract<C>>) => T } = {},
): EvalExtractor<ExtractionResult<InferContract<C>>, T | InferContract<C>> {
  const project = options.project;
  return {
    id: options.id ?? "docture",
    ...(options.config === undefined ? {} : { config: options.config }),
    project: (result) => (project ? project(result) : result.data),
    async extract(input, context) {
      const document = input.documents[0];
      if (!document || input.documents.length !== 1)
        throw new DatasetError("fromDocture requires exactly one document per case.", input.id);
      const bytes = await document.bytes();
      if (bytes.length === 0) throw new DatasetError(`${input.id}: document ${document.name} is empty.`, input.id);
      let result: ExtractionResult<InferContract<C>>;
      try {
        result = await extractor.extract({ bytes, fileName: document.name, mimeType: document.mimeType }, contract, {
          signal: context.signal,
        });
      } catch (error) {
        throw priceFailure(error, options);
      }
      const costUsd = costOf(result.usage, options);
      const attempts = result.attempts.filter((attempt) => attempt.stage === "extract");
      return {
        raw: result,
        method: result.method,
        fallback:
          options.expectedMethod === undefined
            ? attempts.some((attempt) => attempt.status === "failed")
            : result.method !== options.expectedMethod,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          wallMs: result.usage.wallMs,
          pages: result.features.pageCount,
          ...(costUsd === undefined ? {} : { costUsd }),
        },
        ...(project ? {} : evidenceOf(result)),
      };
    },
    dispose: () => extractor.dispose(),
  };
}
