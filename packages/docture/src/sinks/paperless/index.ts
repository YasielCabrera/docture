import { formatFieldPath, parseFieldPath } from "../../core/domain/field-path.js";
import { sha256Hex } from "../../core/conversion/sha256.js";
import { messageOf } from "../../core/pipeline/errors.js";
import { PaperlessError, PaperlessTransport, positiveInteger, digestBytes } from "../../paperless/transport.js";
import { readPaperlessSource } from "../../paperless/read.js";
import { parseDefinition, parseDocument, parseFileMetadata, parseNamedObject, parseNotes, parsePage, record, type PaperlessCustomFieldDefinition, type PaperlessDocument, type PaperlessValue } from "../../paperless/schema.js";
import { canonical, extractionProjection, jsonCopy, parseExtraction, parsePlan, parseProvenance } from "./plan-boundary.js";
import { emptyField, nativeValue, sameValue, valueAt } from "./values.js";
import type { PaperlessApplyResult, PaperlessEvidencePolicy, PaperlessFieldMapping, PaperlessOperation, PaperlessOperationOutcome, PaperlessPlan, PaperlessPlanExtraction, PaperlessPlanInput, PaperlessPlanIssue, PaperlessPlannedSkip, PaperlessSinkOptions } from "./types.js";

export { PaperlessError } from "../../paperless/transport.js";
export type { PaperlessProvenance } from "../../paperless/provenance.js";
export type { PaperlessFieldType, PaperlessValue, PaperlessCustomFieldDefinition } from "../../paperless/schema.js";
export type { PaperlessApplyResult, PaperlessEvidencePolicy, PaperlessFieldMapping, PaperlessOperation, PaperlessOperationOutcome, PaperlessPlan, PaperlessPlanExtraction, PaperlessPlanInput, PaperlessPlanIssue, PaperlessPlannedSkip, PaperlessSinkOptions } from "./types.js";

const LIMITATIONS = [
  "Paperless does not offer conditional metadata writes. A co-writer may change a value after the immediate re-read and before the native write.",
  "Concurrent note creation has no native idempotency key. Stable markers reconcile retries but cannot guarantee exactly-once concurrent delivery.",
  "Documentlink values have native reciprocal effects. Targets must permit changes and their reverse field must be empty or already contain this root ID.",
  "The modeled metadata bulk methods synchronously update values and return OK while background indexing is queued; indexing completion is not implied.",
] as const;

function policy(value: PaperlessEvidencePolicy | undefined): PaperlessEvidencePolicy {
  if (value === undefined) return "verified";
  if (value !== "verified" && value !== "cited" && value !== "any") throw new PaperlessError("Unknown Paperless evidence policy.", "configuration"); return value;
}
function identity(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 512) throw new PaperlessError(`${label} must contain 1 to 512 characters.`, "configuration"); return value;
}
function affected(path: string, conflict: string): boolean {
  const mapped = parseFieldPath(path); const other = parseFieldPath(conflict);
  if (mapped === undefined || other === undefined) return true;
  return mapped.slice(0, Math.min(mapped.length, other.length)).every((segment, index) => segment === other[index]);
}
function evidenceFor(extraction: PaperlessPlanExtraction, path: string): "verified" | "cited-unverified" | "uncited" {
  return extraction.citations.find((citation) => citation.path === path)?.status ?? "uncited";
}
function allowedEvidence(requirement: PaperlessEvidencePolicy, evidence: ReturnType<typeof evidenceFor>): boolean {
  return requirement === "any" || requirement === "cited" && evidence !== "uncited" || evidence === "verified";
}
function operationKey(operation: PaperlessOperation): string {
  return operation.kind === "field" ? `field:${operation.fieldId}` : operation.kind === "tag" ? `tag:${operation.tagId}` : "note";
}

export class PaperlessSink {
  readonly #transport: PaperlessTransport;
  readonly #fields: readonly PaperlessFieldMapping[];
  readonly #tagIds: readonly number[];
  readonly #auditNote: string | undefined;
  readonly #evidence: PaperlessEvidencePolicy;
  readonly #maxOperations: number;
  readonly #maxPlanBytes: number;

  constructor(options: PaperlessSinkOptions) {
    this.#transport = new PaperlessTransport(options);
    this.#evidence = policy(options.evidence);
    this.#maxOperations = positiveInteger(options.maxOperations ?? 1_000, "maxOperations", 10_000);
    this.#maxPlanBytes = positiveInteger(options.maxPlanBytes ?? 4 * 1024 * 1024, "maxPlanBytes", 32 * 1024 * 1024);
    this.#fields = options.fields.map((mapping) => {
      positiveInteger(mapping.fieldId, "fieldId");
      if (!Array.isArray(mapping.path) || mapping.path.some((segment: unknown) => typeof segment !== "string" && !(typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0))) throw new PaperlessError("Mapped paths require string keys or nonnegative integer indexes.", "configuration");
      return Object.freeze({ path: Object.freeze([...mapping.path]), fieldId: mapping.fieldId, ...(mapping.evidence === undefined ? {} : { evidence: policy(mapping.evidence) }) });
    });
    this.#tagIds = Object.freeze([...(options.tagIds ?? [])].map((tag) => positiveInteger(tag, "tagId")));
    this.#auditNote = options.auditNote;
    if (this.#auditNote !== undefined && (typeof this.#auditNote !== "string" || this.#auditNote.trim() === "" || this.#auditNote.length > 8_192)) throw new PaperlessError("auditNote must contain 1 to 8192 characters.", "configuration");
    if (new Set(this.#fields.map((mapping) => mapping.fieldId)).size !== this.#fields.length || new Set(this.#fields.map((mapping) => formatFieldPath(mapping.path))).size !== this.#fields.length || new Set(this.#tagIds).size !== this.#tagIds.length) throw new PaperlessError("Paperless configuration contains duplicate field paths, field IDs or tag IDs.", "configuration");
    if (this.#fields.length + this.#tagIds.length + (this.#auditNote === undefined ? 0 : 1) > this.#maxOperations) throw new PaperlessError("Paperless configured operation limit exceeded.", "limit");
  }

  async plan(input: PaperlessPlanInput): Promise<PaperlessPlan> {
    const source = parseProvenance(jsonCopy(input.provenance, this.#maxPlanBytes));
    const schemaId = identity(input.schemaId, "schemaId"); const mappingId = identity(input.mappingId, "mappingId");
    const extractionId = input.extractionId === undefined ? undefined : identity(input.extractionId, "extractionId");
    const extraction = parseExtraction(jsonCopy(extractionProjection(input.extraction), this.#maxPlanBytes));
    const marker = this.#marker(source, extraction, schemaId, mappingId, extractionId);
    const current = await this.#refresh(source, input.signal);
    const definitions = await this.#definitions(input.signal);
    const blocked = this.#extractionIssues(extraction);
    if (current.userCanChange !== true) blocked.push({ path: "", reason: "Native document change permission is missing or false." });
    const skipped: PaperlessPlannedSkip[] = [];
    const operations: PaperlessOperation[] = [];
    for (const mapping of this.#fields) {
      const path = formatFieldPath(mapping.path);
      const definition = definitions.find((definition) => definition.id === mapping.fieldId);
      if (definition === undefined) { blocked.push({ path, reason: `Native custom field ${mapping.fieldId} is missing or inaccessible.` }); continue; }
      const evidence = evidenceFor(extraction, path);
      if (!allowedEvidence(mapping.evidence ?? this.#evidence, evidence)) { blocked.push({ path, reason: `Configured evidence policy rejects ${evidence} evidence.` }); continue; }
      const proposed = valueAt(extraction.data, mapping.path);
      const value = current.customFields.find((field) => field.field === mapping.fieldId)?.value;
      if (emptyField(definition.type, proposed)) { skipped.push({ path, fieldId: mapping.fieldId, ...(value === undefined ? {} : { current: value }), reason: "The extracted value is empty." }); continue; }
      let native: PaperlessValue;
      try { native = nativeValue(definition, proposed, source.documentId); }
      catch (error) { blocked.push({ path, reason: messageOf(error) }); continue; }
      if (!emptyField(definition.type, value)) { skipped.push({ path, fieldId: mapping.fieldId, current: value ?? null, proposed: native, reason: "The current field is nonempty." }); continue; }
      const reciprocalDocumentIds = definition.type === "documentlink" && Array.isArray(native) ? native : [];
      const targetIssue = await this.#targetIssue(source.documentId, mapping.fieldId, reciprocalDocumentIds, input.signal);
      if (targetIssue !== undefined) { blocked.push({ path, reason: targetIssue }); continue; }
      operations.push({ kind: "field", path, fieldId: mapping.fieldId, fieldType: definition.type, value: native, evidence, reciprocalDocumentIds });
    }
    if (this.#tagIds.length > 0) {
      const tags = (await this.#list("api/tags/", input.signal)).map(parseNamedObject);
      for (const tagId of this.#tagIds) {
        if (!tags.some((tag) => tag.id === tagId)) blocked.push({ path: "", reason: `Native tag ${tagId} is missing or inaccessible.` });
        else operations.push({ kind: "tag", tagId });
      }
    }
    if (this.#auditNote !== undefined) operations.push({ kind: "note", text: `${this.#auditNote}\n[${marker}]` });
    const plan: PaperlessPlan = { kind: "paperless-plan", schemaVersion: 1, source, schemaId, mappingId, ...(extractionId === undefined ? {} : { extractionId }), extraction, marker, operations, blocked, skipped, limitations: LIMITATIONS };
    jsonCopy(plan, this.#maxPlanBytes);
    return plan;
  }

  async apply(value: unknown, options: { readonly signal?: AbortSignal } = {}): Promise<PaperlessApplyResult> {
    const plan = this.inspect(value);
    if (plan.blocked.length > 0 || this.#extractionIssues(plan.extraction).length > 0) throw new PaperlessError("This Paperless plan is blocked by validation, conflict or evidence issues.");
    const outcomes: PaperlessOperationOutcome[] = [];
    const cancelled = () => ({ status: "cancelled" as const, marker: plan.marker, skipped: plan.skipped, outcomes: [...outcomes, ...plan.operations.slice(outcomes.length).map((operation): PaperlessOperationOutcome => ({ operation, status: "skipped", reason: "Cancelled before this operation." }))] });
    if (options.signal?.aborted) return cancelled();
    let definitions: readonly PaperlessCustomFieldDefinition[];
    try { await this.#refresh(plan.source, options.signal); definitions = await this.#definitions(options.signal); }
    catch (error) { if (options.signal?.aborted) return cancelled(); throw error; }
    for (const operation of plan.operations) {
      if (operation.kind !== "field") continue;
      const definition = definitions.find((definition) => definition.id === operation.fieldId);
      if (definition === undefined || definition.type !== operation.fieldType) throw new PaperlessError("A native field definition changed or is inaccessible; create a new plan.");
      nativeValue(definition, operation.value, plan.source.documentId);
    }
    for (const operation of plan.operations) {
      if (options.signal?.aborted) return cancelled();
      let submitted = false;
      try {
        let current = await this.#current(plan.source.documentId, plan.source.fileVersionId, options.signal);
        await this.#assertCurrentSource(plan.source, current, options.signal);
        if (plan.source.variant !== "content") current = await this.#current(plan.source.documentId, plan.source.fileVersionId, options.signal);
        if (current.userCanChange !== true) { outcomes.push({ operation, status: "failed", reason: "Native document change permission is missing or false." }); continue; }
        if (!current.versions.some((version) => version.id === plan.source.fileVersionId)) throw new PaperlessError("Paperless source version changed during apply.", "source-changed");
        if (operation.kind === "field") {
          const definition = definitions.find((definition) => definition.id === operation.fieldId);
          if (definition === undefined || definition.type !== operation.fieldType) { outcomes.push({ operation, status: "failed", reason: "Native field definition changed or is inaccessible." }); continue; }
          nativeValue(definition, operation.value, plan.source.documentId);
          const value = current.customFields.find((field) => field.field === operation.fieldId)?.value;
          if (!emptyField(definition.type, value)) { outcomes.push({ operation, status: "skipped", current: value ?? null, proposed: operation.value, reason: "The current field is nonempty after the immediate re-read." }); continue; }
          const targetIssue = await this.#targetIssue(plan.source.documentId, operation.fieldId, operation.reciprocalDocumentIds, options.signal);
          if (targetIssue !== undefined) { outcomes.push({ operation, status: "skipped", proposed: operation.value, reason: targetIssue }); continue; }
          if (operation.reciprocalDocumentIds.length > 0) {
            current = await this.#current(plan.source.documentId, plan.source.fileVersionId, options.signal);
            const latest = current.customFields.find((field) => field.field === operation.fieldId)?.value;
            if (current.userCanChange !== true || !emptyField(definition.type, latest)) { outcomes.push({ operation, status: "skipped", ...(latest === undefined ? {} : { current: latest }), proposed: operation.value, reason: "The field became nonempty or change permission changed before submission." }); continue; }
          }
        } else if (operation.kind === "tag" && current.tags.includes(operation.tagId)) {
          outcomes.push({ operation, status: "skipped", reason: "The tag is already present." }); continue;
        } else if (operation.kind === "note" && (await this.#notes(plan.source.documentId, options.signal)).some((note) => note.note.includes(`[${plan.marker}]`))) {
          outcomes.push({ operation, status: "skipped", reason: "A note with this extraction marker already exists." }); continue;
        }
        options.signal?.throwIfAborted();
        submitted = true;
        let mutationError: unknown;
        try {
          const body = operation.kind === "field"
            ? { documents: [plan.source.documentId], method: "modify_custom_fields", parameters: { add_custom_fields: { [operation.fieldId]: operation.value }, remove_custom_fields: [] } }
            : operation.kind === "tag" ? { documents: [plan.source.documentId], method: "add_tag", parameters: { tag: operation.tagId } } : { note: operation.text };
          const path = operation.kind === "note" ? `api/documents/${plan.source.documentId}/notes/` : "api/documents/bulk_edit/";
          const response = await this.#transport.json(path, options.signal, { body });
          if (operation.kind !== "note" && record(response.value, "Paperless bulk result").result !== "OK") throw new PaperlessError("Paperless bulk edit did not return its native OK result.", "protocol", undefined, "unknown");
        } catch (error) { mutationError = error; }
        if (options.signal?.aborted) { outcomes.push({ operation, status: "unknown", reason: "Cancelled after submission; the native write outcome is unknown." }); return cancelled(); }
        let confirmed = false;
        try {
          if (operation.kind === "note") confirmed = (await this.#notes(plan.source.documentId, options.signal)).some((note) => note.note.includes(`[${plan.marker}]`));
          else {
            const after = await this.#current(plan.source.documentId, plan.source.fileVersionId, options.signal);
            confirmed = operation.kind === "field" ? sameValue(after.customFields.find((field) => field.field === operation.fieldId)?.value, operation.value) : after.tags.includes(operation.tagId) && current.tags.every((tag) => after.tags.includes(tag));
            if (confirmed && operation.kind === "field" && operation.fieldType === "documentlink") {
              for (const targetId of operation.reciprocalDocumentIds) {
                const target = await this.#current(targetId, undefined, options.signal);
                const reverse = target.customFields.find((field) => field.field === operation.fieldId)?.value;
                if (!Array.isArray(reverse) || !reverse.includes(plan.source.documentId)) confirmed = false;
              }
            }
          }
        } catch (error) { confirmed = false; mutationError ??= error; }
        if (options.signal?.aborted) {
          outcomes.push({ operation, status: confirmed ? "applied" : "unknown", reason: confirmed ? "Read-back confirmed the operation before cancellation." : "Cancelled during read-back; the submitted operation remains uncertain." });
          return cancelled();
        }
        if (confirmed) outcomes.push({ operation, status: "applied", reason: mutationError === undefined ? "Native metadata read-back confirmed the operation." : "Read-back confirmed the operation after an uncertain native response." });
        else if (mutationError instanceof PaperlessError && mutationError.outcome === "rejected") outcomes.push({ operation, status: "failed", reason: mutationError.message });
        else outcomes.push({ operation, status: "unknown", reason: mutationError === undefined ? "Native read-back did not confirm the proposed value." : `Native outcome remains unknown after reconciliation: ${messageOf(mutationError)}` });
      } catch (error) {
        if (options.signal?.aborted) { outcomes.push({ operation, status: submitted ? "unknown" : "skipped", reason: submitted ? "Cancelled after submission; the native write outcome is unknown." : "Cancelled before submission." }); return cancelled(); }
        outcomes.push({ operation, status: submitted ? "unknown" : "failed", reason: messageOf(error) });
        if (error instanceof PaperlessError && error.kind === "source-changed") {
          return { status: "partial", marker: plan.marker, skipped: plan.skipped, outcomes: [...outcomes, ...plan.operations.slice(outcomes.length).map((operation): PaperlessOperationOutcome => ({ operation, status: "skipped", reason: "Source changed before this operation." }))] };
        }
      }
    }
    return { status: outcomes.some((outcome) => outcome.status === "failed" || outcome.status === "unknown") ? "partial" : "complete", marker: plan.marker, outcomes, skipped: plan.skipped };
  }

  inspect(value: unknown): PaperlessPlan {
    const plan = parsePlan(value, this.#maxPlanBytes, this.#maxOperations);
    this.#validateConfiguration(plan);
    return plan;
  }

  #marker(source: PaperlessPlan["source"], extraction: PaperlessPlanExtraction, schemaId: string, mappingId: string, extractionId?: string): string {
    return `docture:${sha256Hex(canonical({ source: { instance: source.instance, documentId: source.documentId, fileVersionId: source.fileVersionId, variant: source.variant, digest: source.digest, apiVersion: source.apiVersion }, extraction, schemaId, mappingId, extractionId: extractionId ?? null, fields: this.#fields, tagIds: this.#tagIds, auditNote: this.#auditNote ?? null, evidence: this.#evidence }))}`;
  }

  #validateConfiguration(plan: PaperlessPlan): void {
    identity(plan.schemaId, "schemaId"); identity(plan.mappingId, "mappingId"); if (plan.extractionId !== undefined) identity(plan.extractionId, "extractionId");
    if (plan.source.instance !== this.#transport.instance || plan.source.apiVersion !== this.#transport.apiVersion) throw new PaperlessError("Paperless plan belongs to a different configured instance or API version.");
    if (plan.marker !== this.#marker(plan.source, plan.extraction, plan.schemaId, plan.mappingId, plan.extractionId)) throw new PaperlessError("Paperless plan marker does not match its extraction, source and current configuration.");
    for (const operation of plan.operations) {
      if (operation.kind === "field") {
        const mapping = this.#fields.find((mapping) => mapping.fieldId === operation.fieldId && formatFieldPath(mapping.path) === operation.path);
        const raw = mapping === undefined ? undefined : valueAt(plan.extraction.data, mapping.path);
        const proposed = operation.fieldType === "monetary" && typeof raw === "number" ? String(raw) : raw;
        if (mapping === undefined || !sameValue(proposed, operation.value) || evidenceFor(plan.extraction, operation.path) !== operation.evidence || !allowedEvidence(mapping.evidence ?? this.#evidence, operation.evidence)) throw new PaperlessError("Paperless plan operation violates configured mapping or evidence policy.");
        if (operation.fieldType === "documentlink" ? !sameValue(operation.reciprocalDocumentIds, operation.value) : operation.reciprocalDocumentIds.length !== 0) throw new PaperlessError("Paperless reciprocal targets do not match the configured field value.");
      } else if (operation.kind === "tag") {
        if (!this.#tagIds.includes(operation.tagId)) throw new PaperlessError("Paperless plan contains an unconfigured tag.");
      } else if (this.#auditNote === undefined || operation.text !== `${this.#auditNote}\n[${plan.marker}]`) throw new PaperlessError("Paperless plan contains an unconfigured note.");
    }
    const operationKeys = plan.operations.map(operationKey);
    if (new Set(operationKeys).size !== operationKeys.length) throw new PaperlessError("Paperless plan contains duplicate operations.");
  }

  #extractionIssues(extraction: PaperlessPlanExtraction): PaperlessPlanIssue[] {
    const issues: PaperlessPlanIssue[] = extraction.validation.valid ? [] : extraction.validation.issues.map((issue) => ({ path: issue.path, reason: issue.message }));
    if (!extraction.validation.valid && issues.length === 0) issues.push({ path: "", reason: "Extraction validation failed." });
    for (const mapping of this.#fields) {
      const path = formatFieldPath(mapping.path);
      if (extraction.conflicts.some((conflict) => affected(path, conflict.path))) issues.push({ path, reason: "A mapped extraction path has a conflict." });
    }
    return issues;
  }

  async #refresh(source: PaperlessPlan["source"], signal?: AbortSignal): Promise<PaperlessDocument> {
    if (source.instance !== this.#transport.instance || source.apiVersion !== this.#transport.apiVersion) throw new PaperlessError("Paperless source belongs to a different configured instance.");
    const current = await readPaperlessSource(this.#transport, source.documentId, { mode: source.variant, versionId: source.fileVersionId, ...(signal === undefined ? {} : { signal }) });
    if (current.provenance.digest !== source.digest || current.provenance.nativeChecksum !== source.nativeChecksum || current.provenance.fileVersionId !== source.fileVersionId || current.provenance.variant !== source.variant) throw new PaperlessError("Paperless extraction source changed; create a new extraction and plan.", "source-changed");
    return this.#current(source.documentId, source.fileVersionId, signal);
  }

  async #current(documentId: number, versionId: number | undefined, signal?: AbortSignal): Promise<PaperlessDocument> {
    const raw = parseDocument((await this.#transport.json(`api/documents/${documentId}/?truncate_content=false${versionId === undefined ? "" : `&version=${versionId}`}`, signal)).value);
    if (raw.id !== documentId || raw.rootDocumentId !== null) throw new PaperlessError("Paperless root metadata returned a different document identity."); return raw;
  }
  async #assertCurrentSource(source: PaperlessPlan["source"], current: PaperlessDocument, signal?: AbortSignal): Promise<void> {
    const version = current.versions.find((version) => version.id === source.fileVersionId);
    const original = source.metadata.versions.find((version) => version.id === source.fileVersionId);
    if (version === undefined || version.checksum !== original?.checksum) throw new PaperlessError("Paperless source version changed during apply.", "source-changed");
    if (source.variant === "content") {
      if (await digestBytes(new TextEncoder().encode(current.content)) !== source.digest) throw new PaperlessError("Paperless extraction source changed during apply.", "source-changed");
    } else {
      const metadata = parseFileMetadata((await this.#transport.json(`api/documents/${source.documentId}/metadata/?version=${source.fileVersionId}`, signal)).value);
      const checksum = source.variant === "archive" ? metadata.archiveChecksum : metadata.originalChecksum;
      if (checksum !== source.nativeChecksum || source.variant === "archive" && !metadata.hasArchive) throw new PaperlessError("Paperless extraction source changed during apply.", "source-changed");
    }
  }
  async #targetIssue(rootId: number, fieldId: number, targets: readonly number[], signal?: AbortSignal): Promise<string | undefined> {
    for (const targetId of targets) {
      if (targetId === rootId) return "A documentlink cannot contain a self-link.";
      try {
        const target = await this.#current(targetId, undefined, signal);
        if (target.userCanChange !== true) return `Documentlink target ${targetId} lacks confirmed change permission.`;
        const reverse = target.customFields.find((field) => field.field === fieldId)?.value;
        if (!emptyField("documentlink", reverse) && !(Array.isArray(reverse) && reverse.includes(rootId))) return `Documentlink target ${targetId} has a nonempty reciprocal field.`;
      } catch (error) { signal?.throwIfAborted(); return `Documentlink target ${targetId} is inaccessible: ${messageOf(error)}`; }
    }
    return undefined;
  }
  async #list(path: string, signal?: AbortSignal): Promise<readonly unknown[]> {
    const first = this.#transport.url(path); let next: string | null = first.href;
    const values: unknown[] = []; const visited = new Set<string>();
    while (next !== null) {
      const url = this.#transport.url(next);
      if (url.pathname !== first.pathname || visited.has(url.href) || visited.size >= 100) throw new PaperlessError("Paperless definition pagination limit or origin check failed.", "limit");
      visited.add(url.href); const page = parsePage((await this.#transport.json(url.href, signal)).value); values.push(...page.results);
      if (values.length > 10_000) throw new PaperlessError("Paperless definition count limit exceeded.", "limit");
      next = page.next === null ? null : new URL(page.next, url).href;
    }
    return values;
  }
  async #definitions(signal?: AbortSignal): Promise<readonly PaperlessCustomFieldDefinition[]> {
    const definitions = (await this.#list("api/custom_fields/", signal)).map(parseDefinition);
    if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) throw new PaperlessError("Paperless returned duplicate field definitions."); return definitions;
  }
  async #notes(documentId: number, signal?: AbortSignal) {
    return parseNotes((await this.#transport.json(`api/documents/${documentId}/notes/`, signal)).value);
  }
}

export function paperlessSink(options: PaperlessSinkOptions): PaperlessSink { return new PaperlessSink(options); }
