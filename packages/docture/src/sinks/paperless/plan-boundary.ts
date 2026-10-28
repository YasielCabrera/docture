import { PaperlessError } from "../../paperless/transport.js";
import { array, fieldValue, id, parseDocument, freezeMetadata, record, string, type PaperlessFieldType } from "../../paperless/schema.js";
import type { PaperlessProvenance } from "../../paperless/provenance.js";
import type { PaperlessOperation, PaperlessPlan, PaperlessPlanExtraction } from "./types.js";

export function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new PaperlessError(`${label} contains unknown extra keys.`);
}

export function jsonCopy(value: unknown, maxBytes: number): unknown {
  const active = new Set<object>();
  let nodes = 0; let characters = 0;
  const validate = (value: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 64) throw new PaperlessError("Paperless plan traversal limit exceeded.", "limit");
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "string") { characters += value.length; if (characters > maxBytes) throw new PaperlessError("Paperless plan byte limit exceeded.", "limit"); return; }
    if (value instanceof Date && Number.isFinite(value.getTime())) return;
    if (typeof value !== "object" || value === null || active.has(value)) throw new PaperlessError("Paperless plans require finite, acyclic JSON values.");
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new PaperlessError("Paperless plans require plain JSON objects.");
    active.add(value);
    for (const [key, child] of Object.entries(value)) { characters += key.length; if (characters > maxBytes) throw new PaperlessError("Paperless plan byte limit exceeded.", "limit"); validate(child, depth + 1); }
    active.delete(value);
  };
  validate(value, 0);
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).length > maxBytes) throw new PaperlessError("Paperless plan byte limit exceeded.", "limit");
  const parsed: unknown = JSON.parse(serialized); return parsed;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function extractionProjection(raw: { readonly data: unknown; readonly validation: { readonly valid: boolean; readonly issues: readonly { readonly path: string; readonly message: string }[] }; readonly citations?: readonly { readonly path: string; readonly status: "verified" | "cited-unverified" | "uncited"; readonly ids: readonly string[] }[]; readonly conflicts?: readonly { readonly path: string }[] }): PaperlessPlanExtraction {
  return { data: raw.data, validation: { valid: raw.validation.valid, issues: raw.validation.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, citations: (raw.citations ?? []).map((citation) => ({ path: citation.path, status: citation.status, ids: [...citation.ids] })), conflicts: (raw.conflicts ?? []).map((conflict) => ({ path: conflict.path })) };
}

export function parseExtraction(value: unknown): PaperlessPlanExtraction {
  const raw = record(value, "Paperless plan extraction"); keys(raw, ["data", "validation", "citations", "conflicts"], "Paperless plan extraction");
  if (!Object.hasOwn(raw, "data")) throw new PaperlessError("Paperless plan extraction requires data.");
  const validation = record(raw.validation, "Paperless plan validation"); keys(validation, ["valid", "issues"], "Paperless plan validation");
  if (typeof validation.valid !== "boolean") throw new PaperlessError("Paperless plan validation.valid must be boolean.");
  const issues = array(validation.issues, "Paperless validation issues").map((value) => { const issue = record(value, "Paperless validation issue"); keys(issue, ["path", "message"], "Paperless validation issue"); return { path: string(issue.path, "Issue path"), message: string(issue.message, "Issue message") }; });
  if (validation.valid && issues.length > 0) throw new PaperlessError("Paperless validation issues contradict a valid result.");
  const citations = array(raw.citations, "Paperless citations").map((value): PaperlessPlanExtraction["citations"][number] => { const citation = record(value, "Paperless citation"); keys(citation, ["path", "status", "ids"], "Paperless citation"); const status = citation.status; if (status !== "verified" && status !== "cited-unverified" && status !== "uncited") throw new PaperlessError("Unsupported Paperless evidence status."); const ids = array(citation.ids, "Paperless evidence IDs").map((value) => string(value, "Paperless evidence ID")); if (status === "verified" && ids.length === 0 || status === "uncited" && ids.length !== 0) throw new PaperlessError("Paperless evidence IDs contradict their status."); return { path: string(citation.path, "Paperless citation path"), status, ids }; });
  if (new Set(citations.map((citation) => citation.path)).size !== citations.length) throw new PaperlessError("Paperless citations contain duplicate paths.");
  const conflicts = array(raw.conflicts, "Paperless conflicts").map((value) => { const conflict = record(value, "Paperless conflict"); keys(conflict, ["path"], "Paperless conflict"); return { path: string(conflict.path, "Conflict path") }; });
  return { data: raw.data, validation: { valid: validation.valid, issues }, citations, conflicts };
}

export function parseProvenance(value: unknown): PaperlessProvenance {
  const raw = record(value, "Paperless source provenance"); keys(raw, ["kind", "schemaVersion", "instance", "documentId", "fileVersionId", "variant", "digest", "apiVersion", "serverVersion", "nativeChecksum", "metadata", "uiUrl"], "Paperless source provenance");
  if (raw.kind !== "paperless" || raw.schemaVersion !== 1 || raw.apiVersion !== 9 && raw.apiVersion !== 10 || raw.variant !== "content" && raw.variant !== "archive" && raw.variant !== "original") throw new PaperlessError("Unsupported Paperless source provenance version or variant.");
  const metadata = record(raw.metadata, "Paperless root metadata"); keys(metadata, ["id", "rootDocumentId", "title", "tags", "customFields", "correspondent", "documentType", "versions", "userCanChange"], "Paperless root metadata");
  const versions = array(metadata.versions, "Paperless source versions").map((value) => { const version = record(value, "Paperless stored version"); keys(version, ["id", "isRoot", "checksum", "added"], "Paperless stored version"); return { id: version.id, is_root: version.isRoot, checksum: version.checksum, added: version.added }; });
  const document = parseDocument({ id: metadata.id, root_document: metadata.rootDocumentId, title: metadata.title, content: "", tags: metadata.tags, custom_fields: metadata.customFields, correspondent: metadata.correspondent, document_type: metadata.documentType, versions, ...(metadata.userCanChange === undefined ? {} : { user_can_change: metadata.userCanChange }) });
  const documentId = id(raw.documentId, "Paperless source root ID"); const fileVersionId = id(raw.fileVersionId, "Paperless source file version ID");
  const instance = string(raw.instance, "Paperless instance"); const digest = string(raw.digest, "Paperless source digest"); const serverVersion = string(raw.serverVersion, "Paperless server version");
  if (!/^[a-f0-9]{64}$/u.test(digest) || !/^3\.\d+\.\d+(?:[-+].*)?$/u.test(serverVersion) || document.id !== documentId || document.rootDocumentId !== null || !document.versions.some((version) => version.id === fileVersionId)) throw new PaperlessError("Invalid Paperless source identity.");
  if (raw.nativeChecksum !== null && typeof raw.nativeChecksum !== "string") throw new PaperlessError("Paperless native checksum must be text or null.");
  const uiUrl = string(raw.uiUrl, "Paperless source UI URL");
  return { kind: "paperless", schemaVersion: 1, instance, documentId, fileVersionId, variant: raw.variant, digest, apiVersion: raw.apiVersion, serverVersion, nativeChecksum: raw.nativeChecksum, metadata: freezeMetadata(document), uiUrl };
}

export function parsePlan(value: unknown, maxBytes: number, maxOperations: number): PaperlessPlan {
  const raw = record(jsonCopy(value, maxBytes), "Paperless plan");
  keys(raw, ["kind", "schemaVersion", "source", "schemaId", "mappingId", "extractionId", "extraction", "marker", "operations", "blocked", "skipped", "limitations"], "Paperless plan");
  if (raw.kind !== "paperless-plan" || raw.schemaVersion !== 1) throw new PaperlessError("Unsupported Paperless plan version.");
  const operations = array(raw.operations, "Paperless plan operations"); if (operations.length > maxOperations) throw new PaperlessError("Paperless operation limit exceeded.", "limit");
  const parsed = operations.map((value): PaperlessOperation => {
    const operation = record(value, "Paperless operation");
    if (operation.kind === "field") {
      keys(operation, ["kind", "path", "fieldId", "fieldType", "value", "evidence", "reciprocalDocumentIds"], "Paperless field operation");
      const fieldType = operation.fieldType;
      if (typeof fieldType !== "string" || !["string", "longtext", "url", "date", "boolean", "integer", "float", "monetary", "documentlink", "select"].includes(fieldType)) throw new PaperlessError("Unsupported native field type in plan.");
      const evidence = operation.evidence; if (evidence !== "verified" && evidence !== "cited-unverified" && evidence !== "uncited") throw new PaperlessError("Unsupported evidence status in plan.");
      const value = operation.value;
      if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && !(Array.isArray(value) && value.every((value: unknown) => typeof value === "number"))) throw new PaperlessError("Invalid native value in plan.");
      return { kind: "field", path: string(operation.path, "Paperless mapped path"), fieldId: id(operation.fieldId, "Paperless field ID"), fieldType: fieldType as PaperlessFieldType, value, evidence, reciprocalDocumentIds: array(operation.reciprocalDocumentIds, "Reciprocal document IDs").map((value) => id(value, "Reciprocal document ID")) };
    }
    if (operation.kind === "tag") { keys(operation, ["kind", "tagId"], "Paperless tag operation"); return { kind: "tag", tagId: id(operation.tagId, "Paperless tag ID") }; }
    if (operation.kind === "note") { keys(operation, ["kind", "text"], "Paperless note operation"); return { kind: "note", text: string(operation.text, "Paperless note text") }; }
    throw new PaperlessError("Unsupported Paperless operation.");
  });
  const operationIds = parsed.map((operation) => operation.kind === "field" ? `field:${operation.fieldId}` : operation.kind === "tag" ? `tag:${operation.tagId}` : "note");
  if (new Set(operationIds).size !== operationIds.length) throw new PaperlessError("Paperless plan contains duplicate operations.");
  const blocked = array(raw.blocked, "Blocked operations").map((value) => { const issue = record(value, "Blocked issue"); keys(issue, ["path", "reason"], "Blocked issue"); return { path: string(issue.path, "Blocked path"), reason: string(issue.reason, "Blocked reason") }; });
  const skipped = array(raw.skipped, "Skipped operations").map((value) => { const skip = record(value, "Skipped operation"); keys(skip, ["path", "fieldId", "current", "proposed", "reason"], "Skipped operation"); return { path: string(skip.path, "Skipped path"), fieldId: id(skip.fieldId, "Skipped field ID"), reason: string(skip.reason, "Skipped reason"), ...(skip.current === undefined ? {} : { current: fieldValue(skip.current) }), ...(skip.proposed === undefined ? {} : { proposed: fieldValue(skip.proposed) }) }; });
  return { kind: "paperless-plan", schemaVersion: 1, source: parseProvenance(raw.source), schemaId: string(raw.schemaId, "Schema ID"), mappingId: string(raw.mappingId, "Mapping ID"), ...(raw.extractionId === undefined ? {} : { extractionId: string(raw.extractionId, "Extraction ID") }), extraction: parseExtraction(raw.extraction), marker: string(raw.marker, "Extraction marker"), operations: parsed, blocked, skipped, limitations: array(raw.limitations, "Plan limitations").map((value) => string(value, "Plan limitation")) };
}
