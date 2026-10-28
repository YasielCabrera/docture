import type { Readable } from "node:stream";
import { Writable } from "node:stream";
import { createDisposalScope, type ConversionFormat, type ContractLike, type FlexibleSchema, type ScopedDisposable } from "docture";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { explain } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { resolveConfig, type LoadedConfig } from "../config.js";
import { expandInputs, sourcesOf, type Input } from "../inputs.js";
import { convertedContent, convertInputs, inspectInputs, inspectProbe } from "../operations.js";
import { envelope, errorRecord, recordOf, type Command, type Envelope, type Item } from "../output.js";
import { version } from "../version.js";
import { buildConversionWiring, buildWiring, type Wiring, type ConversionWiring } from "../wiring.js";
import { importEngine } from "./engines.js";
import { paperlessTools, callPaperlessTool } from "./paperless.js";

export interface McpServerOptions {
  /** `cwd` resolves relative sources and the config; `diagnostic` takes warnings. */
  readonly io: Io;
  /** Aborting cancels every tool call in flight. */
  readonly signal?: AbortSignal;
  /** A config file to use instead of the nearest `docture.config.*`. */
  readonly configPath?: string;
  /** Ignore any config file. */
  readonly noConfig?: boolean;
}

const FORMATS = ["markdown", "html", "text", "json"] as const satisfies readonly ConversionFormat[];

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

const TOOLS: Tool[] = [
  {
    name: "convert",
    description:
      "Convert a document to Markdown, HTML, plain text, or Docture's versioned JSON. " +
      "Returns the content in a version 1 envelope. Writes no files and calls no model.",
    inputSchema: {
      type: "object",
      properties: {
        source: SOURCE,
        format: { type: "string", enum: [...FORMATS], default: "markdown" },
        pages: { ...PAGES, description: "One-based page numbers to convert, keeping their original numbers. Default: every page" },
      },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect",
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
  },
  {
    name: "extract",
    description: "Extract with the server's configured extractor and schema. Returns full citation, verification, validation, conflict and native evidence records. Model input cannot set a model or schema.",
    inputSchema: {
      type: "object", properties: { source: SOURCE, schemaName: { type: "string", description: "A name from config.schemas. Omit to use config.schema." } },
      required: ["source"], additionalProperties: false,
    },
  },
];

class InvalidArguments extends Error {}

async function toolConfig(options: McpServerOptions): Promise<LoadedConfig | undefined> {
  return resolveConfig({
    cwd: options.io.cwd,
    ...(options.configPath === undefined ? {} : { explicit: options.configPath }),
    ...(options.noConfig === true ? { disabled: true } : {}),
  });
}

function extractionSchema(config: LoadedConfig | undefined, schemaName: unknown): FlexibleSchema | ContractLike {
  if (schemaName !== undefined && (typeof schemaName !== "string" || schemaName.trim() === "" || schemaName.length > 256)) throw new InvalidArguments("schemaName must name a configured schema.");
  const schema = schemaName === undefined ? config?.config.schema
    : config?.config.schemas !== undefined && Object.hasOwn(config.config.schemas, schemaName) ? config.config.schemas[schemaName] : undefined;
  if (schema === undefined) throw new InvalidArguments("No such configured schema. Configure schema or schemas before extraction.");
  return schema;
}

async function configuredExtraction(options: McpServerOptions, source: string, schema: FlexibleSchema | ContractLike, signal: AbortSignal, wiring: Wiring) {
  const inputs = await expandInputs([source], options.io.cwd);
  const results = [];
  for await (const item of wiring.extractor.extractBatch(await sourcesOf(inputs, options.io, signal), schema, { signal, concurrency: wiring.concurrency })) {
    const file = inputs[item.index]?.label ?? String(item.index);
    results.push(item.outcome.ok ? recordOf(file, item.outcome.result, true) : errorRecord(file, explain(item.outcome.error)));
  }
  return envelope("extract", results);
}

function argumentsOf(raw: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  const args = raw ?? {};
  if (typeof args !== "object" || Array.isArray(args)) throw new InvalidArguments("Arguments must be an object.");
  const unknown = Object.keys(args).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new InvalidArguments(`Unknown argument "${unknown}".`);
  return args as Record<string, unknown>;
}

function sourceOf(args: Readonly<Record<string, unknown>>): string {
  const source = args["source"];
  if (typeof source !== "string" || source.trim() === "") {
    throw new InvalidArguments("source must be a non-empty path or URL.");
  }
  if (source === "-") throw new InvalidArguments("source cannot be - : stdin carries the MCP transport.");
  return source;
}

function formatOf(args: Readonly<Record<string, unknown>>): ConversionFormat {
  const format = args["format"] ?? "markdown";
  const match = FORMATS.find((candidate) => candidate === format);
  if (match === undefined) throw new InvalidArguments(`format must be one of ${FORMATS.join(", ")}.`);
  return match;
}

function pagesOf(args: Readonly<Record<string, unknown>>): readonly number[] | undefined {
  const pages = args["pages"];
  if (pages === undefined) return undefined;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => Number.isInteger(p) && p >= 1)) {
    throw new InvalidArguments("pages must be a non-empty array of one-based page numbers.");
  }
  return pages;
}

type ToolCall =
  | {
    readonly tool: "convert";
    readonly source: string;
    readonly format: ConversionFormat;
    readonly pages: readonly number[] | undefined;
  }
  | { readonly tool: "inspect"; readonly source: string; readonly pages: readonly number[] | undefined };

function toolCall(name: string, raw: unknown): ToolCall {
  if (name === "convert") {
    const args = argumentsOf(raw, ["source", "format", "pages"]);
    return { tool: name, source: sourceOf(args), format: formatOf(args), pages: pagesOf(args) };
  }
  if (name === "inspect") {
    const args = argumentsOf(raw, ["source", "pages"]);
    return { tool: name, source: sourceOf(args), pages: pagesOf(args) };
  }
  throw new InvalidArguments(`Unknown tool "${name}".`);
}

function failedEnvelope(command: Command, source: string, error: unknown): Envelope<never> {
  return envelope(command, [errorRecord(source, explain(error))]);
}

function toolResult(result: { readonly version: 1; readonly command: Command; readonly ok: boolean; readonly results: readonly unknown[] }): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: { ...result },
    isError: !result.ok,
  };
}

async function convertTool(
  options: McpServerOptions,
  inputs: readonly Input[],
  format: ConversionFormat,
  pages: readonly number[] | undefined,
  signal: AbortSignal,
  wiring: ConversionWiring,
): Promise<Envelope<unknown>> {
  for (const warning of wiring.warnings) options.io.diagnostic(`! ${warning}\n`);
  const records = new Array<Item<unknown> | undefined>(inputs.length);
  const batch = convertInputs(wiring.converter, inputs, options.io, {
    format,
    ...(pages === undefined ? {} : { pages }),
    assets: "omit",
    signal,
    concurrency: wiring.concurrency,
  });
  for await (const { index, input, outcome } of batch) {
    records[index] = outcome.ok
      ? { file: input.label, ok: true, ...convertedContent(outcome.result) }
      : errorRecord(input.label, explain(outcome.error));
  }
  signal.throwIfAborted();
  return envelope("convert", records.filter((record) => record !== undefined));
}

async function inspectTool(
  options: McpServerOptions,
  inputs: readonly Input[],
  pages: readonly number[] | undefined,
  signal: AbortSignal,
  wiring: Wiring,
): Promise<Envelope<unknown>> {
  for (const warning of wiring.warnings) options.io.diagnostic(`! ${warning}\n`);
  const records: Item<unknown>[] = [];
  for await (const record of inspectInputs(wiring.extractor, inputs, options.io, pages === undefined ? {} : { pages }, signal)) {
    records.push(record);
  }
  return envelope("inspect", records);
}

/**
 * An MCP server with conversion, inspection and configured extraction tools. Pipelines
 * stay warm until close(), which cancels calls and disposes their resources. Connect it to
 * any transport. The server owns the tools handlers, so do not register further
 * tools on it.
 *
 * @throws MissingEngineError when `@modelcontextprotocol/sdk` is not installed.
 */
export async function createMcpServer(options: McpServerOptions): Promise<McpServer> {
  const [{ McpServer: Server }, protocol] = await importEngine(() =>
    Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]),
  );
  const server = new Server({ name: "docture", version: version() }, { capabilities: { tools: {} } });
  const scope = createDisposalScope();
  const stopped = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let configPromise: Promise<LoadedConfig | undefined> | undefined;
  const getConfig = (): Promise<LoadedConfig | undefined> => configPromise ??= toolConfig(options);
  let extraction: Promise<Wiring> | undefined;
  let inspection: Promise<Wiring> | undefined;
  let conversion: Promise<ConversionWiring> | undefined;
  const wiring = async (kind: "extract" | "inspect"): Promise<Wiring> => {
    const config = await getConfig();
    const shared = { io: options.io, ...(config === undefined ? {} : { config }), flags: {}, disposalScope: scope };
    if (kind === "extract") return extraction ??= buildWiring({ ...shared, flags: { citations: true }, needsModel: true });
    return inspection ??= buildWiring({ ...shared, needsModel: false, before: [inspectProbe({ text: false, lines: false, render: false })], ignoreSuppliedExtractor: true });
  };
  const conversionWiring = async (): Promise<ConversionWiring> => {
    const config = await getConfig();
    return conversion ??= buildConversionWiring({ io: options.io, ...(config === undefined ? {} : { config }), flags: {}, disposalScope: scope });
  };
  const close = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => {
    stopped.abort();
    await close();
    await Promise.allSettled(pending);
    const built = await Promise.allSettled([extraction, inspection, conversion]);
    const disposed = await Promise.allSettled(built.flatMap((result) => result.status === "fulfilled" && result.value !== undefined ? [result.value.dispose()] : []));
    const config = (await configPromise?.catch(() => undefined))?.config;
    const supplied: ScopedDisposable[] = [...(config?.loaders ?? []), ...(config?.strategies ?? []), ...(config?.classifiers ?? []), ...(config?.layoutAnalyzer === undefined ? [] : [config.layoutAnalyzer]), ...(typeof config?.extractor === "object" ? [config.extractor] : []), ...(typeof config?.converter === "object" ? [config.converter] : [])];
    await scope.dispose(...supplied);
    const failures = disposed.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "MCP resources failed to dispose.");
  })();

  // The high-level registerTool API only accepts Zod schemas; these handlers serve
  // the JSON Schemas above directly, so the CLI needs no Zod at run time.
  server.server.setRequestHandler(protocol.ListToolsRequestSchema, async () => ({ tools: [...TOOLS, ...paperlessTools(await getConfig())] }));
  server.server.setRequestHandler(protocol.CallToolRequestSchema, (request, extra) => {
    const work = (async () => {
      const signal = AbortSignal.any([extra.signal, stopped.signal, ...(options.signal === undefined ? [] : [options.signal])]);
      if (request.params.name.startsWith("paperless_")) {
        try {
          const config = await getConfig();
          if (config === undefined) throw new InvalidArguments("Paperless tools require server configuration.");
          const result = await callPaperlessTool(request.params.name, request.params.arguments, { io: options.io, config, signal, ...(["paperless_extract", "paperless_plan"].includes(request.params.name) ? { getWiring: () => wiring("extract") } : {}) });
          return toolResult(result);
        } catch (error) {
          signal.throwIfAborted();
          return toolResult(failedEnvelope("paperless", "paperless", error));
        }
      }
      if (request.params.name === "extract") {
        let source = "document";
        try {
          const args = argumentsOf(request.params.arguments, ["source", "schemaName"]);
          source = sourceOf(args);
          const schema = extractionSchema(await getConfig(), args["schemaName"]);
          return toolResult(await configuredExtraction(options, source, schema, signal, await wiring("extract")));
        } catch (error) {
          if (error instanceof InvalidArguments) throw new protocol.McpError(protocol.ErrorCode.InvalidParams, error.message);
          signal.throwIfAborted();
          return toolResult(failedEnvelope("extract", source, error));
        }
      }
      let call: ToolCall;
      try {
        call = toolCall(request.params.name, request.params.arguments);
      } catch (error) {
        if (error instanceof InvalidArguments) {
          throw new protocol.McpError(protocol.ErrorCode.InvalidParams, error.message);
        }
        throw error;
      }
      try {
        const inputs = await expandInputs([call.source], options.io.cwd);
        return toolResult(
          call.tool === "inspect"
            ? await inspectTool(options, inputs, call.pages, signal, await wiring("inspect"))
            : await convertTool(options, inputs, call.format, call.pages, signal, await conversionWiring()),
        );
      } catch (error) {
        signal.throwIfAborted();
        return toolResult(failedEnvelope(call.tool, call.source, error));
      }
    })();
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
  });
  return server;
}

export interface StdioOptions extends McpServerOptions {
  readonly stdin: Readable;
}

/**
 * Serve over newline-delimited JSON-RPC: frames in from `stdin`, frames out
 * through `io.write` and nothing else. Resolves when the input ends, the client
 * disconnects, or `signal` aborts, after cancelling calls still in flight.
 */
export async function serveStdio(options: StdioOptions): Promise<void> {
  const { StdioServerTransport } = await importEngine(() => import("@modelcontextprotocol/sdk/server/stdio.js"));
  const stopped = new AbortController();
  const signal = options.signal === undefined ? stopped.signal : AbortSignal.any([options.signal, stopped.signal]);
  const server = await createMcpServer({ ...options, signal });
  const stdout = new Writable({
    write(chunk: Buffer, _encoding, done) {
      options.io.write(chunk.toString("utf8"));
      done();
    },
  });

  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => {
      stopped.abort();
      resolve();
    };
  });
  const stop = (): void => void server.close();
  options.stdin.once("end", stop);
  signal.addEventListener("abort", stop, { once: true });
  try {
    await server.connect(new StdioServerTransport(options.stdin, stdout));
    await closed;
  } finally {
    options.stdin.off("end", stop);
    signal.removeEventListener("abort", stop);
    await server.close();
  }
}
