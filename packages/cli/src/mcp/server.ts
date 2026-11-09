import type { Readable } from "node:stream";
import { Writable } from "node:stream";
import { createDisposalScope, type ConversionFormat, type ContractLike, type FlexibleSchema, type ScopedDisposable } from "docture";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { explain, MCP_HINTS, UsageError } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { resolveConfig, type LoadedConfig } from "../config.js";
import { expandInputs, sourcesOf, type Input } from "../inputs.js";
import { convertedContent, convertInputs, inspectInputs, inspectProbe } from "../operations.js";
import { envelope, errorRecord, recordOf, type Command, type Envelope, type Item } from "../output.js";
import { version } from "../version.js";
import { buildConversionWiring, buildWiring, type Wiring, type ConversionWiring } from "../wiring.js";
import { importEngine } from "./engines.js";
import { paperlessTools, callPaperlessTool } from "./paperless.js";
import { coreTools, DEFAULT_MAX_CHARS, FORMATS, schemaNames } from "./tools.js";

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

async function toolConfig(options: McpServerOptions): Promise<LoadedConfig | undefined> {
  return resolveConfig({
    cwd: options.io.cwd,
    ...(options.configPath === undefined ? {} : { explicit: options.configPath }),
    ...(options.noConfig === true ? { disabled: true } : {}),
  });
}

function extractionSchema(config: LoadedConfig | undefined, schemaName: unknown): FlexibleSchema | ContractLike {
  if (schemaName !== undefined && (typeof schemaName !== "string" || schemaName.trim() === "" || schemaName.length > 256)) throw new UsageError("schemaName must name a configured schema.");
  const names = schemaNames(config);
  const choose = names.length > 0
    ? `Pass schemaName as one of ${names.map((name) => `"${name}"`).join(", ")}. list_schemas describes each.`
    : config?.config.schema === undefined
      ? "Set schema or schemas in the server's docture.config.ts."
      : "This server has one default schema and no named schemas. Omit schemaName to use it.";
  if (schemaName === undefined) {
    if (config?.config.schema !== undefined) return config.config.schema;
    throw new UsageError(names.length === 0 ? "This server has no configured schema." : "This server has no default schema.", choose);
  }
  const schemas = config?.config.schemas;
  const schema = schemas !== undefined && Object.hasOwn(schemas, schemaName) ? schemas[schemaName] : undefined;
  if (schema === undefined) throw new UsageError(`No configured schema is named "${schemaName}".`, choose);
  return schema;
}

function descriptionOf(schema: ContractLike): string | undefined {
  const description: unknown = (schema as { readonly description?: unknown }).description;
  return typeof description === "string" && description.trim() !== "" ? description : undefined;
}

function schemaListing(config: LoadedConfig | undefined) {
  const schemas = config?.config.schemas ?? {};
  return {
    version: 1,
    command: "list_schemas",
    ok: true,
    defaultSchema: config?.config.schema !== undefined,
    schemas: Object.entries(schemas).map(([name, schema]) => {
      const description = descriptionOf(schema);
      return { name, ...(description === undefined ? {} : { description }) };
    }),
  } as const;
}

async function configuredExtraction(options: McpServerOptions, source: string, schema: FlexibleSchema | ContractLike, signal: AbortSignal, wiring: Wiring) {
  const inputs = await expandInputs([source], options.io.cwd);
  const results = [];
  for await (const item of wiring.extractor.extractBatch(await sourcesOf(inputs, options.io, signal), schema, { signal, concurrency: wiring.concurrency })) {
    const file = inputs[item.index]?.label ?? String(item.index);
    results.push(item.outcome.ok ? recordOf(file, item.outcome.result, true) : errorRecord(file, explain(item.outcome.error, MCP_HINTS)));
  }
  return envelope("extract", results);
}

function argumentsOf(raw: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  const args = raw ?? {};
  if (typeof args !== "object" || Array.isArray(args)) throw new UsageError("Arguments must be an object.");
  const unknown = Object.keys(args).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new UsageError(`Unknown argument "${unknown}".`);
  return args as Record<string, unknown>;
}

function sourceOf(args: Readonly<Record<string, unknown>>): string {
  const source = args["source"];
  if (typeof source !== "string" || source.trim() === "") {
    throw new UsageError("source must be a non-empty path or URL.");
  }
  if (source === "-") throw new UsageError("source cannot be - : stdin carries the MCP transport.");
  return source;
}

function formatOf(args: Readonly<Record<string, unknown>>): ConversionFormat {
  const format = args["format"] ?? "markdown";
  const match = FORMATS.find((candidate) => candidate === format);
  if (match === undefined) throw new UsageError(`format must be one of ${FORMATS.join(", ")}.`);
  return match;
}

function pagesOf(args: Readonly<Record<string, unknown>>): readonly number[] | undefined {
  const pages = args["pages"];
  if (pages === undefined) return undefined;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => Number.isInteger(p) && p >= 1)) {
    throw new UsageError("pages must be a non-empty array of one-based page numbers.");
  }
  return pages;
}

function integerOf(args: Readonly<Record<string, unknown>>, name: string, minimum: number, fallback: number): number {
  const value = args[name] ?? fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new UsageError(`${name} must be a whole number of at least ${minimum}.`);
  }
  return value;
}

interface Window {
  readonly offset: number;
  readonly maxChars: number;
}

/** True when `index` falls between the two halves of a surrogate pair. */
function splitsPair(content: string, index: number): boolean {
  const before = content.charCodeAt(index - 1);
  const after = content.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** A slice of at most `maxChars`, widened to one whole pair when that pair alone would not fit. */
function windowOf(content: string, window: Window) {
  const totalChars = content.length;
  let offset = Math.min(window.offset, totalChars);
  if (splitsPair(content, offset)) offset -= 1;
  let end = Math.min(totalChars, offset + window.maxChars);
  if (splitsPair(content, end)) end += end - 1 > offset ? -1 : 1;
  const truncated = end < totalChars;
  return { content: content.slice(offset, end), offset, totalChars, truncated, ...(truncated ? { nextOffset: end } : {}) };
}

type ToolCall =
  | {
    readonly tool: "convert";
    readonly source: string;
    readonly format: ConversionFormat;
    readonly pages: readonly number[] | undefined;
    readonly window: Window;
  }
  | { readonly tool: "inspect"; readonly source: string; readonly pages: readonly number[] | undefined };

function toolCall(name: "convert" | "inspect", args: Readonly<Record<string, unknown>>): ToolCall {
  if (name === "convert") {
    return {
      tool: name, source: sourceOf(args), format: formatOf(args), pages: pagesOf(args),
      window: { offset: integerOf(args, "offset", 0, 0), maxChars: integerOf(args, "maxChars", 1, DEFAULT_MAX_CHARS) },
    };
  }
  return { tool: name, source: sourceOf(args), pages: pagesOf(args) };
}

function failedEnvelope(command: Command, source: string, error: unknown): Envelope<never> {
  return envelope(command, [errorRecord(source, explain(error, MCP_HINTS))]);
}

function toolResult(result: { readonly version: 1; readonly command: string; readonly ok: boolean }): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: { ...result },
    isError: !result.ok,
  };
}

function sourceLabel(raw: unknown): string {
  const source = typeof raw === "object" && raw !== null ? (raw as { readonly source?: unknown }).source : undefined;
  return typeof source === "string" && source.trim() !== "" ? source.slice(0, 256) : "arguments";
}

async function convertTool(
  options: McpServerOptions,
  inputs: readonly Input[],
  call: Extract<ToolCall, { tool: "convert" }>,
  signal: AbortSignal,
  wiring: ConversionWiring,
): Promise<Envelope<unknown>> {
  for (const warning of wiring.warnings) options.io.diagnostic(`! ${warning}\n`);
  const records = new Array<Item<unknown> | undefined>(inputs.length);
  const batch = convertInputs(wiring.converter, inputs, options.io, {
    format: call.format,
    ...(call.pages === undefined ? {} : { pages: call.pages }),
    assets: "omit",
    signal,
    concurrency: wiring.concurrency,
  });
  for await (const { index, input, outcome } of batch) {
    records[index] = outcome.ok
      ? { file: input.label, ok: true, ...convertedContent(outcome.result), ...windowOf(outcome.result.content, call.window) }
      : errorRecord(input.label, explain(outcome.error, MCP_HINTS));
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
  for await (const record of inspectInputs(wiring.extractor, inputs, options.io, { ...(pages === undefined ? {} : { pages }), hints: MCP_HINTS }, signal)) {
    records.push(record);
  }
  return envelope("inspect", records);
}

function isCoreTool(name: string): name is "convert" | "inspect" | "extract" {
  return name === "convert" || name === "inspect" || name === "extract";
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
  // the JSON Schemas in tools.ts directly, so the CLI needs no Zod at run time.
  server.server.setRequestHandler(protocol.ListToolsRequestSchema, async () => {
    const config = await getConfig();
    return { tools: [...coreTools(config), ...paperlessTools(config)] };
  });
  server.server.setRequestHandler(protocol.CallToolRequestSchema, (request, extra) => {
    const work = (async (): Promise<CallToolResult> => {
      const { name, arguments: raw } = request.params;
      const signal = AbortSignal.any([extra.signal, stopped.signal, ...(options.signal === undefined ? [] : [options.signal])]);
      if (!isCoreTool(name)) {
        const config = await getConfig();
        if (config === undefined || ![...coreTools(config), ...paperlessTools(config)].some((tool) => tool.name === name)) {
          throw new protocol.McpError(protocol.ErrorCode.InvalidParams, `Unknown tool "${name}".`);
        }
        if (name === "list_schemas") {
          try {
            argumentsOf(raw, []);
            return toolResult(schemaListing(config));
          } catch (error) {
            const failure = { version: 1, command: "list_schemas", ok: false, error: errorRecord("arguments", explain(error, MCP_HINTS)).error };
            return { content: [{ type: "text", text: JSON.stringify(failure, null, 2) }], isError: true };
          }
        }
        try {
          const result = await callPaperlessTool(name, raw, { io: options.io, config, signal, ...(["paperless_extract", "paperless_plan"].includes(name) ? { getWiring: () => wiring("extract") } : {}) });
          return toolResult(result);
        } catch (error) {
          signal.throwIfAborted();
          return toolResult(failedEnvelope("paperless", "paperless", error));
        }
      }
      const source = sourceLabel(raw);
      try {
        if (name === "extract") {
          const args = argumentsOf(raw, ["source", "schemaName"]);
          const schema = extractionSchema(await getConfig(), args["schemaName"]);
          return toolResult(await configuredExtraction(options, sourceOf(args), schema, signal, await wiring("extract")));
        }
        const call = toolCall(name, argumentsOf(raw, name === "convert" ? ["source", "format", "pages", "offset", "maxChars"] : ["source", "pages"]));
        const inputs = await expandInputs([call.source], options.io.cwd);
        return toolResult(
          call.tool === "inspect"
            ? await inspectTool(options, inputs, call.pages, signal, await wiring("inspect"))
            : await convertTool(options, inputs, call, signal, await conversionWiring()),
        );
      } catch (error) {
        signal.throwIfAborted();
        return toolResult(failedEnvelope(name, source, error));
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
