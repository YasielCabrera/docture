import { UsageError } from "../cli/errors.js";
import type { PaperlessCliConfig, PaperlessSchemaConfig } from "./types.js";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function positive(value: unknown, maximum = Number.MAX_SAFE_INTEGER): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum; }
function knownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function evidence(value: unknown): boolean { return value === undefined || value === "verified" || value === "cited" || value === "any"; }
function schema(value: unknown): boolean {
  if (!record(value) || !knownKeys(value, ["contract", "source", "mappingId", "fields", "tagIds", "auditNote", "evidence"])) return false;
  if (!(record(value.contract) || typeof value.contract === "function") || typeof value.mappingId !== "string" || value.mappingId.trim() === "" || !record(value.source) || !knownKeys(value.source, ["mode", "archiveFallback"])) return false;
  if (!["content", "archive", "original"].includes(String(value.source.mode)) || value.source.archiveFallback !== undefined && value.source.archiveFallback !== "original") return false;
  if (!Array.isArray(value.fields) || !value.fields.every((field: unknown) => record(field) && knownKeys(field, ["path", "fieldId", "evidence"]) && positive(field.fieldId) && Array.isArray(field.path) && field.path.every((segment: unknown) => typeof segment === "string" || typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) && evidence(field.evidence))) return false;
  if (value.tagIds !== undefined && (!Array.isArray(value.tagIds) || !value.tagIds.every((tag: unknown) => positive(tag)))) return false;
  return evidence(value.evidence) && (value.auditNote === undefined || typeof value.auditNote === "string" && value.auditNote.trim() !== "");
}

export function isPaperlessConfig(value: unknown): value is PaperlessCliConfig {
  if (!record(value) || !knownKeys(value, ["connection", "schemas", "enableApply", "maxResults"]) || !record(value.connection) || !record(value.schemas)) return false;
  const connection = value.connection;
  if (!knownKeys(connection, ["baseUrl", "apiVersion", "token", "headers", "fetch", "timeoutMs", "maxResponseBytes"]) || !(typeof connection.baseUrl === "string" || connection.baseUrl instanceof URL) || connection.apiVersion !== 9 && connection.apiVersion !== 10) return false;
  if (connection.token !== undefined && typeof connection.token !== "string" || connection.fetch !== undefined && typeof connection.fetch !== "function") return false;
  if (connection.headers !== undefined && (!record(connection.headers) || !Object.values(connection.headers).every((value) => typeof value === "string"))) return false;
  if (connection.timeoutMs !== undefined && !positive(connection.timeoutMs) || connection.maxResponseBytes !== undefined && !positive(connection.maxResponseBytes)) return false;
  if (Object.keys(value.schemas).length === 0 || !Object.entries(value.schemas).every(([name, value]) => name.trim() !== "" && name.length <= 128 && schema(value))) return false;
  return (value.enableApply === undefined || typeof value.enableApply === "boolean") && (value.maxResults === undefined || positive(value.maxResults, 1000));
}

export function configuredPaperless(value: PaperlessCliConfig | undefined): PaperlessCliConfig {
  if (!isPaperlessConfig(value)) throw new UsageError("Paperless requires connection and named schemas in docture.config."); return value;
}

export function configuredSchema(config: PaperlessCliConfig, name: string): PaperlessSchemaConfig {
  if (!Object.hasOwn(config.schemas, name)) throw new UsageError(`Unknown configured Paperless schema "${name}".`);
  const schema = config.schemas[name]; if (schema === undefined) throw new UsageError(`Unknown configured Paperless schema "${name}".`); return schema;
}
