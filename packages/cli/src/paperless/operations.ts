import { createHash } from "node:crypto";
import { resolveSchema, schemaOf } from "docture";
import { PaperlessSource, type PaperlessSourceResult } from "docture/sources/paperless";
import { PaperlessSink, type PaperlessPlan } from "docture/sinks/paperless";
import { UsageError } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import type { LoadedConfig } from "../config.js";
import { recordOf } from "../output.js";
import { buildWiring, type Wiring } from "../wiring.js";
import { configuredPaperless, configuredSchema } from "./config.js";
import type { PaperlessCliConfig, PaperlessSchemaConfig } from "./types.js";

export type PaperlessSelection =
  | { readonly documentId: number; readonly versionId?: number }
  | { readonly query: string; readonly limit?: number };
export type PaperlessAction =
  | { readonly kind: "read"; readonly documentId: number; readonly versionId?: number }
  | { readonly kind: "search"; readonly query?: string; readonly limit?: number }
  | { readonly kind: "extract" | "plan"; readonly schemaName: string; readonly selection: PaperlessSelection; readonly dryRun?: boolean }
  | { readonly kind: "apply"; readonly schemaName: string; readonly plan: unknown; readonly dryRun?: boolean };
export interface PaperlessOperationContext { readonly io: Io; readonly config: LoadedConfig; readonly signal: AbortSignal; readonly getWiring?: () => Promise<Wiring> }
export interface PaperlessOperationResult {
  readonly version: 1;
  readonly command: "paperless";
  readonly action: PaperlessAction["kind"];
  readonly ok: boolean;
  readonly results: readonly Record<string, unknown>[];
}

function limit(value: number | undefined, config: PaperlessCliConfig): number {
  const maximum = config.maxResults ?? 100;
  value ??= Math.min(10, maximum);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new UsageError(`Paperless limit must be a positive integer no greater than the configured ${maximum}.`); return value;
}
function checkedId(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new UsageError("Paperless document and version IDs must be positive integers."); return value; }
function sinkFor(config: PaperlessCliConfig, profile: PaperlessSchemaConfig): PaperlessSink {
  return new PaperlessSink({ ...config.connection, fields: profile.fields, ...(profile.tagIds === undefined ? {} : { tagIds: profile.tagIds }), ...(profile.auditNote === undefined ? {} : { auditNote: profile.auditNote }), ...(profile.evidence === undefined ? {} : { evidence: profile.evidence }) });
}
async function schemaId(name: string, profile: PaperlessSchemaConfig): Promise<string> {
  const resolved = await resolveSchema(schemaOf(profile.contract));
  return `${name}:${createHash("sha256").update(JSON.stringify(resolved.jsonSchema)).digest("hex")}`;
}
function result(action: PaperlessAction["kind"], results: readonly Record<string, unknown>[]): PaperlessOperationResult {
  return { version: 1, command: "paperless", action, ok: results.every((item) => item.ok === true), results };
}
function contentRecord(source: PaperlessSourceResult): Record<string, unknown> {
  if (!("loaded" in source.source)) throw new UsageError("Paperless read/search requires the stored content representation.");
  return { file: `paperless:${source.provenance.documentId}`, ok: true, source: source.provenance, text: source.source.loaded.text, limitations: source.limitations };
}
async function* selected(source: PaperlessSource, selection: PaperlessSelection, profile: PaperlessSchemaConfig, config: PaperlessCliConfig, signal: AbortSignal): AsyncGenerator<PaperlessSourceResult> {
  if ("documentId" in selection) {
    checkedId(selection.documentId); if (selection.versionId !== undefined) checkedId(selection.versionId);
    yield await source.read(selection.documentId, { ...profile.source, ...(selection.versionId === undefined ? {} : { versionId: selection.versionId }), signal });
  } else {
    for await (const item of source.query({ ...profile.source, query: selection.query, limit: limit(selection.limit, config), signal })) yield item;
  }
}

export async function runPaperlessAction(action: PaperlessAction, context: PaperlessOperationContext): Promise<PaperlessOperationResult> {
  const config = configuredPaperless(context.config.config.paperless);
  const source = new PaperlessSource(config.connection);
  if (action.kind === "read") {
    const read = await source.read(checkedId(action.documentId), { mode: "content", ...(action.versionId === undefined ? {} : { versionId: checkedId(action.versionId) }), signal: context.signal });
    return result(action.kind, [contentRecord(read)]);
  }
  if (action.kind === "search") {
    const results: Record<string, unknown>[] = [];
    for await (const item of source.query({ mode: "content", limit: limit(action.limit, config), ...(action.query === undefined ? {} : { query: action.query }), signal: context.signal })) results.push(contentRecord(item));
    return result(action.kind, results);
  }
  const profile = configuredSchema(config, action.schemaName);
  const sink = sinkFor(config, profile);
  const currentSchemaId = await schemaId(action.schemaName, profile);
  if (action.kind === "apply") {
    const plan = sink.inspect(action.plan);
    if (plan.schemaId !== currentSchemaId || plan.mappingId !== profile.mappingId) throw new UsageError("The saved plan does not match the current configured schema or mapping.");
    if (action.dryRun === true) return result(action.kind, [{ file: `paperless:${plan.source.documentId}`, ok: true, dryRun: true, source: plan.source, plan }]);
    const applied = await sink.apply(plan, { signal: context.signal });
    return result(action.kind, [{ file: `paperless:${plan.source.documentId}`, ok: applied.status === "complete", source: plan.source, apply: applied }]);
  }
  const wiring = context.getWiring === undefined ? await buildWiring({ io: context.io, config: context.config, flags: { citations: true }, needsModel: true }) : await context.getWiring();
  const results: Record<string, unknown>[] = [];
  try {
    for await (const item of selected(source, action.selection, profile, config, context.signal)) {
      const extracted = await wiring.extractor.extract(item.source, profile.contract, { signal: context.signal });
      const record = { ...recordOf(`paperless:${item.provenance.documentId}`, extracted, true), source: item.provenance, limitations: item.limitations, ...("loaded" in item.source ? { sourceText: item.source.loaded.text } : {}) };
      if (action.kind === "plan" || action.dryRun === true) {
        const plan: PaperlessPlan = await sink.plan({ provenance: item.provenance, extraction: extracted, schemaId: currentSchemaId, mappingId: profile.mappingId, signal: context.signal });
        results.push({ ...record, ok: plan.blocked.length === 0, ...(action.dryRun === true ? { dryRun: true } : {}), plan });
      } else results.push(record);
    }
  } finally { if (context.getWiring === undefined) await wiring.dispose(); }
  return result(action.kind, results);
}
