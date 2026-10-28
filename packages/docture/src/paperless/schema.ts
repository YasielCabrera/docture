import { PaperlessError, positiveInteger } from "./transport.js";

export type PaperlessValue = string | number | boolean | null | readonly number[];
export interface PaperlessFieldValue { readonly field: number; readonly value: PaperlessValue }
export interface PaperlessVersion { readonly id: number; readonly isRoot: boolean; readonly checksum: string | null; readonly added: string }
export interface PaperlessDocument {
  readonly id: number;
  readonly rootDocumentId: number | null;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly number[];
  readonly customFields: readonly PaperlessFieldValue[];
  readonly correspondent: number | null;
  readonly documentType: number | null;
  readonly versions: readonly PaperlessVersion[];
  readonly userCanChange?: boolean;
}
export type PaperlessMetadata = Omit<PaperlessDocument, "content">;
export type PaperlessFieldType = "string" | "longtext" | "url" | "date" | "boolean" | "integer" | "float" | "monetary" | "documentlink" | "select";
export type PaperlessCustomFieldDefinition = { readonly id: number; readonly name: string } & (
  | { readonly type: "select"; readonly options: readonly { readonly id: string; readonly label: string }[] }
  | { readonly type: Exclude<PaperlessFieldType, "select"> }
);
export interface PaperlessNamedObject { readonly id: number; readonly name: string }
export interface PaperlessNote { readonly id: number; readonly note: string }
export interface PaperlessFileMetadata {
  readonly hasArchive: boolean;
  readonly originalMimeType: string;
  readonly originalChecksum: string | null;
  readonly archiveChecksum: string | null;
  readonly originalFilename: string | null;
  readonly archiveFilename: string | null;
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PaperlessError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new PaperlessError(`${label} must be text.`); return value;
}
export function id(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new PaperlessError(`${label} must be a positive integer.`); return value;
}
export function nullableId(value: unknown, label: string): number | null { return value === null ? null : id(value, label); }
export function nullableString(value: unknown, label: string): string | null { return value === null ? null : string(value, label); }
export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new PaperlessError(`${label} must be an array.`); return value;
}
export function fieldValue(value: unknown): PaperlessValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((entry: unknown) => typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0)) return value;
  throw new PaperlessError("Paperless custom field contains an unsupported value.");
}
export function parseDocument(value: unknown): PaperlessDocument {
  const raw = record(value, "Paperless document");
  if (raw.user_can_change !== undefined && typeof raw.user_can_change !== "boolean") throw new PaperlessError("Paperless document change permission must be boolean.");
  const versions = array(raw.versions, "Paperless document versions").map((entry) => { const version = record(entry, "Paperless version"); if (typeof version.is_root !== "boolean") throw new PaperlessError("Paperless version is_root must be boolean."); return { id: id(version.id, "Paperless version ID"), isRoot: version.is_root, checksum: nullableString(version.checksum, "Paperless checksum"), added: string(version.added, "Paperless version date") }; });
  if (versions.length === 0 || new Set(versions.map((version) => version.id)).size !== versions.length || versions.filter((version) => version.isRoot).length !== 1) throw new PaperlessError("Paperless document must identify one root and distinct file versions.");
  return { id: id(raw.id, "Paperless document ID"), rootDocumentId: nullableId(raw.root_document, "Paperless root ID"), title: string(raw.title, "Paperless document title"), content: string(raw.content, "Paperless document content"), tags: array(raw.tags, "Paperless tags").map((tag) => id(tag, "Paperless tag ID")), customFields: array(raw.custom_fields, "Paperless custom fields").map((entry) => { const field = record(entry, "Paperless custom field"); return { field: id(field.field, "Paperless custom field ID"), value: fieldValue(field.value) }; }), correspondent: nullableId(raw.correspondent, "Paperless correspondent"), documentType: nullableId(raw.document_type, "Paperless document type"), versions, ...(typeof raw.user_can_change === "boolean" ? { userCanChange: raw.user_can_change } : {}) };
}
export function parseFileMetadata(value: unknown): PaperlessFileMetadata {
  const raw = record(value, "Paperless file metadata");
  if (typeof raw.has_archive_version !== "boolean") throw new PaperlessError("Paperless archive availability must be boolean.");
  return { hasArchive: raw.has_archive_version, originalMimeType: string(raw.original_mime_type, "Paperless original MIME type"), originalChecksum: nullableString(raw.original_checksum, "Paperless original checksum"), archiveChecksum: nullableString(raw.archive_checksum, "Paperless archive checksum"), originalFilename: nullableString(raw.original_filename, "Paperless original filename"), archiveFilename: nullableString(raw.archive_media_filename, "Paperless archive filename") };
}
export function parsePage(value: unknown): { readonly results: readonly unknown[]; readonly next: string | null } {
  const raw = record(value, "Paperless pagination");
  if (typeof raw.count !== "number" || !Number.isSafeInteger(raw.count) || raw.count < 0) throw new PaperlessError("Paperless pagination count must be a nonnegative integer.");
  return { results: array(raw.results, "Paperless pagination results"), next: nullableString(raw.next, "Paperless pagination next URL") };
}
export function parseDefinition(value: unknown): PaperlessCustomFieldDefinition {
  const raw = record(value, "Paperless custom-field definition");
  const base = { id: id(raw.id, "Paperless definition ID"), name: string(raw.name, "Paperless field name") };
  const type = raw.data_type;
  if (type === "select") {
    const extra = record(raw.extra_data, "Paperless select options");
    const options = array(extra.select_options, "Paperless select options").map((value) => { const option = record(value, "Paperless select option"); return { id: string(option.id, "Paperless select option ID"), label: string(option.label, "Paperless select option label") }; });
    if (options.length === 0 || new Set(options.map((option) => option.id)).size !== options.length) throw new PaperlessError("Paperless select requires distinct existing options.");
    return { ...base, type, options };
  }
  switch (type) {
    case "string": case "longtext": case "url": case "date": case "boolean": case "integer": case "float": case "monetary": case "documentlink": return { ...base, type };
    default: throw new PaperlessError("Paperless custom field has an unsupported native data type.");
  }
}
export function parseNamedObject(value: unknown): PaperlessNamedObject {
  const raw = record(value, "Paperless named object"); return { id: id(raw.id, "Paperless object ID"), name: string(raw.name, "Paperless object name") };
}
export function parseNotes(value: unknown): readonly PaperlessNote[] {
  return array(value, "Paperless notes").map((value) => { const raw = record(value, "Paperless note"); return { id: id(raw.id, "Paperless note ID"), note: string(raw.note, "Paperless note text") }; });
}
export function freezeDocument(document: PaperlessDocument): PaperlessDocument {
  return Object.freeze({ ...document, tags: Object.freeze([...document.tags]), customFields: Object.freeze(document.customFields.map((field) => Object.freeze({ ...field, ...(Array.isArray(field.value) ? { value: Object.freeze([...field.value]) } : {}) }))), versions: Object.freeze(document.versions.map((version) => Object.freeze({ ...version }))) });
}
export function freezeMetadata(document: PaperlessDocument): PaperlessMetadata {
  const { content: _content, ...metadata } = freezeDocument(document);
  return Object.freeze(metadata);
}
export function checkedLimit(value: number | undefined, defaultValue: number, label: string, maximum: number): number { return positiveInteger(value ?? defaultValue, label, maximum); }
