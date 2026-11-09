import type { ConversionFormat } from "docture";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { LoadedConfig } from "../config.js";

export const FORMATS = ["markdown", "html", "text", "json"] as const satisfies readonly ConversionFormat[];

export const DEFAULT_MAX_CHARS = 20_000;

type JsonSchema = Readonly<Record<string, unknown>>;
type OutputSchema = NonNullable<Tool["outputSchema"]>;

const SOURCE = {
  type: "string",
  description: "A path relative to the server's working directory, an absolute path, or an http(s) or file: URL",
} as const;

const PAGES = {
  type: "array",
  items: { type: "integer", minimum: 1 },
  minItems: 1,
  description: "One-based page numbers to load. Default: every page",
} as const;

const FAILED_ITEM = {
  type: "object",
  properties: {
    file: { type: "string" },
    ok: { type: "boolean", const: false },
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" }, hint: { type: "string" } },
      required: ["code", "message"],
    },
  },
  required: ["file", "ok", "error"],
} as const;

function envelopeSchema(command: string, item: JsonSchema, extra: JsonSchema = {}): OutputSchema {
  return {
    type: "object",
    properties: {
      version: { type: "integer", const: 1 },
      command: { type: "string", const: command },
      ok: { type: "boolean", description: "True when every result item succeeded" },
      results: { type: "array", items: { anyOf: [item, FAILED_ITEM] } },
      ...extra,
    },
    required: ["version", "command", "ok", "results"],
  };
}

function okItem(properties: JsonSchema, required: readonly string[]): JsonSchema {
  return {
    type: "object",
    properties: { file: { type: "string" }, ok: { type: "boolean", const: true }, ...properties },
    required: ["file", "ok", ...required],
  };
}

const CONVERTED = okItem({
  format: { type: "string", enum: [...FORMATS] },
  mimeType: { type: "string" },
  content: { type: "string", description: "The characters from offset, at most maxChars of them" },
  offset: { type: "integer", minimum: 0, description: "Where content starts in the whole conversion" },
  totalChars: { type: "integer", minimum: 0, description: "Length of the whole conversion" },
  truncated: { type: "boolean", description: "True when characters remain after content" },
  nextOffset: { type: "integer", minimum: 1, description: "The offset to pass to read on. Present only when truncated" },
  pageCount: { type: "integer", minimum: 0 },
  loader: { type: "string" },
  method: { type: "string" },
  warnings: {
    type: "array",
    items: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" }, pageNumber: { type: "integer", minimum: 1 } },
      required: ["code", "message"],
    },
  },
}, ["format", "mimeType", "content", "offset", "totalChars", "truncated", "pageCount", "loader", "method", "warnings"]);

const INSPECTED = okItem({
  loader: { type: "string" },
  features: {
    type: "object",
    properties: {
      mimeType: { type: "string" },
      pageCount: { type: "integer", minimum: 0 },
      textLength: { type: "integer", minimum: 0 },
      hasTextLayer: { type: "boolean" },
      hasGeometry: { type: "boolean" },
      hasRenderablePages: { type: "boolean" },
      form: { type: "string" },
      extra: { type: "object", additionalProperties: { type: "boolean" } },
    },
    required: ["mimeType", "pageCount", "textLength", "hasTextLayer", "hasGeometry", "hasRenderablePages", "form"],
  },
  pages: {
    type: "array",
    items: {
      type: "object",
      properties: {
        pageNumber: { type: "integer", minimum: 1 },
        width: { type: "number" },
        height: { type: "number" },
        chars: { type: "integer", minimum: 0 },
        lines: { type: "integer", minimum: 0 },
      },
      required: ["pageNumber", "width", "height", "chars", "lines"],
    },
  },
}, ["loader", "features", "pages"]);

const EXTRACTED = okItem({
  data: { description: "The value your configured schema accepted" },
  method: { type: "string" },
  loader: { type: "string" },
  attempts: { type: "array", items: { type: "object" } },
  usage: { type: "object" },
  features: { type: "object" },
  validation: { type: "object" },
}, ["data"]);

const PAPERLESS_ITEM = {
  type: "object",
  properties: { file: { type: "string" }, ok: { type: "boolean" } },
  required: ["file", "ok"],
} as const;

export function schemaNames(config: LoadedConfig | undefined): readonly string[] {
  const schemas = config?.config.schemas;
  return schemas === undefined ? [] : Object.keys(schemas);
}

function schemaNameArgument(config: LoadedConfig | undefined): JsonSchema {
  const names = schemaNames(config);
  return {
    type: "string",
    description: "A name from config.schemas; list_schemas describes each. Omit to use config.schema.",
    ...(names.length === 0 ? {} : { enum: names }),
  };
}

export function coreTools(config: LoadedConfig | undefined): Tool[] {
  return [
    {
      name: "convert",
      title: "Convert a document",
      description:
        "Convert a document to Markdown, HTML, plain text, or Docture's versioned JSON. " +
        `Returns at most maxChars characters (default ${DEFAULT_MAX_CHARS}) from offset in a version 1 envelope. ` +
        "When truncated is true, call again with offset set to nextOffset. Writes no files and calls no model.",
      inputSchema: {
        type: "object",
        properties: {
          source: SOURCE,
          format: { type: "string", enum: [...FORMATS], default: "markdown" },
          pages: { ...PAGES, description: "One-based page numbers to convert, keeping their original numbers. Default: every page" },
          offset: { type: "integer", minimum: 0, default: 0, description: "Character offset into the converted content. Pass a previous result's nextOffset" },
          maxChars: { type: "integer", minimum: 1, default: DEFAULT_MAX_CHARS, description: "Most characters of content to return per document" },
        },
        required: ["source"],
        additionalProperties: false,
      },
      outputSchema: envelopeSchema("convert", CONVERTED),
      annotations: { title: "Convert a document", readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "inspect",
      title: "Inspect a document",
      description:
        "Report what the loader sees in a document: page sizes, text and line counts, and the " +
        "document facts strategies are routed by. Calls no model.",
      inputSchema: {
        type: "object",
        properties: {
          source: SOURCE,
          pages: PAGES,
        },
        required: ["source"],
        additionalProperties: false,
      },
      outputSchema: envelopeSchema("inspect", INSPECTED),
      annotations: { title: "Inspect a document", readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "extract",
      title: "Extract with a configured schema",
      description: "Extract with the server's configured extractor and schema. Returns full citation, verification, validation, conflict and native evidence records. Model input cannot set a model or schema.",
      inputSchema: {
        type: "object", properties: { source: SOURCE, schemaName: schemaNameArgument(config) },
        required: ["source"], additionalProperties: false,
      },
      outputSchema: envelopeSchema("extract", EXTRACTED),
      annotations: { title: "Extract with a configured schema", readOnlyHint: true, openWorldHint: true },
    },
    ...(schemaNames(config).length === 0 ? [] : [LIST_SCHEMAS]),
  ];
}

const LIST_SCHEMAS: Tool = {
  name: "list_schemas",
  title: "List configured schemas",
  description: "List the schema names extract accepts as schemaName, with each contract's description. Reads only the server configuration.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      version: { type: "integer", const: 1 },
      command: { type: "string", const: "list_schemas" },
      ok: { type: "boolean", const: true },
      defaultSchema: { type: "boolean", description: "True when extract without schemaName uses config.schema" },
      schemas: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, description: { type: "string" } },
          required: ["name"],
        },
      },
    },
    required: ["version", "command", "ok", "defaultSchema", "schemas"],
  },
  annotations: { title: "List configured schemas", readOnlyHint: true, openWorldHint: false },
};

export const PAPERLESS_OUTPUT = envelopeSchema("paperless", PAPERLESS_ITEM, { action: { type: "string" } });
