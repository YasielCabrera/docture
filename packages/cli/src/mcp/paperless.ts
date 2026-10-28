import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { LoadedConfig } from "../config.js";
import type { Wiring } from "../wiring.js";
import type { Io } from "../cli/io.js";
import { UsageError } from "../cli/errors.js";
import { configuredPaperless } from "../paperless/config.js";
import { runPaperlessAction, type PaperlessAction, type PaperlessSelection } from "../paperless/operations.js";

const ID = { type: "integer", minimum: 1 } as const;
const SCHEMA = { type: "string", minLength: 1, description: "A schema name configured by the server owner" } as const;
const SELECT = { documentId: ID, versionId: ID, query: { type: "string" }, limit: { type: "integer", minimum: 1 } } as const;
function tool(name: string, description: string, properties: Record<string, object>, required: string[]): Tool {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false, ...(name === "paperless_extract" || name === "paperless_plan" ? { oneOf: [{ required: ["documentId"], not: { anyOf: [{ required: ["query"] }, { required: ["limit"] }] } }, { required: ["query"], not: { anyOf: [{ required: ["documentId"] }, { required: ["versionId"] }] } }] } : {}) } };
}
export function paperlessTools(config: LoadedConfig | undefined): readonly Tool[] {
  if (config?.config.paperless === undefined) return [];
  const configured = configuredPaperless(config.config.paperless);
  const maximum = configured.maxResults ?? 100;
  const limit = { type: "integer", minimum: 1, maximum, default: Math.min(10, maximum) };
  return [
    tool("paperless_read", "Read exact stored Paperless OCR text and versioned source identity. No model or writes.", { documentId: ID, versionId: ID }, ["documentId"]),
    tool("paperless_search", "Read bounded Paperless query results using full content, never snippets. No writes.", { query: { type: "string" }, limit }, []),
    tool("paperless_extract", "Extract with a server-configured schema and pipeline, preserving evidence and exact source identity.", { ...SELECT, limit, schemaName: SCHEMA }, ["schemaName"]),
    tool("paperless_plan", "Create a read-only fill-empty plan with the configured schema and field mapping. Returns validation and evidence blockers.", { ...SELECT, limit, schemaName: SCHEMA }, ["schemaName"]),
    ...(configured.enableApply === true ? [tool("paperless_apply", "Explicitly apply a configured fill-empty plan after source and current-value checks. Returns partial and skipped outcomes.", { schemaName: SCHEMA, plan: { type: "object" } }, ["schemaName", "plan"])] : []),
  ];
}
function argsOf(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UsageError("Paperless arguments must be an object.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new UsageError("Paperless arguments contain an unknown or unconfigured option."); return args;
}
function integer(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new UsageError(`${label} must be a positive integer.`); return value; }
function schemaName(args: Record<string, unknown>): string { if (typeof args.schemaName !== "string" || args.schemaName.trim() === "") throw new UsageError("schemaName must be a configured schema name."); return args.schemaName; }
function selection(args: Record<string, unknown>): PaperlessSelection {
  if (args.documentId !== undefined) {
    if (args.query !== undefined || args.limit !== undefined) throw new UsageError("A single Paperless ID cannot be combined with query or limit.");
    return { documentId: integer(args.documentId, "documentId"), ...(args.versionId === undefined ? {} : { versionId: integer(args.versionId, "versionId") }) };
  }
  if (typeof args.query !== "string" || args.versionId !== undefined) throw new UsageError("Select a Paperless documentId or query.");
  return { query: args.query, ...(args.limit === undefined ? {} : { limit: integer(args.limit, "limit") }) };
}
export async function callPaperlessTool(name: string, raw: unknown, context: { readonly io: Io; readonly config: LoadedConfig; readonly signal: AbortSignal; readonly getWiring?: () => Promise<Wiring> }) {
  const config = configuredPaperless(context.config.config.paperless);
  let action: PaperlessAction;
  if (name === "paperless_read") { const args = argsOf(raw, ["documentId", "versionId"]); action = { kind: "read", documentId: integer(args.documentId, "documentId"), ...(args.versionId === undefined ? {} : { versionId: integer(args.versionId, "versionId") }) }; }
  else if (name === "paperless_search") { const args = argsOf(raw ?? {}, ["query", "limit"]); if (args.query !== undefined && typeof args.query !== "string") throw new UsageError("query must be text."); action = { kind: "search", ...(typeof args.query === "string" ? { query: args.query } : {}), ...(args.limit === undefined ? {} : { limit: integer(args.limit, "limit") }) }; }
  else if (name === "paperless_extract" || name === "paperless_plan") { const args = argsOf(raw, ["documentId", "versionId", "query", "limit", "schemaName"]); action = { kind: name === "paperless_extract" ? "extract" : "plan", schemaName: schemaName(args), selection: selection(args) }; }
  else if (name === "paperless_apply") { if (config.enableApply !== true) throw new UsageError("Paperless apply is disabled by server configuration."); const args = argsOf(raw, ["schemaName", "plan"]); action = { kind: "apply", schemaName: schemaName(args), plan: args.plan }; }
  else throw new UsageError("Unknown Paperless tool.");
  return runPaperlessAction(action, context);
}
