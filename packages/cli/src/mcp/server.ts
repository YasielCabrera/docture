/**
 * The MCP server behind `docture mcp` and `@docture/cli/mcp`.
 *
 * Each tool call resolves the config, builds model-free wiring, runs the same
 * operation the command runs, and disposes the wiring, so a long-lived server
 * holds no engine between calls. Results are the CLI's version 1 envelope, as
 * structured content and as JSON text. Nothing here writes to `io.write`; on stdio
 * that stream belongs to the transport.
 */

import type { Readable } from "node:stream";
import { Writable } from "node:stream";
import type { ConversionFormat } from "docture";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { explain } from "../cli/errors.js";
import type { Io } from "../cli/io.js";
import { resolveConfig, type LoadedConfig } from "../config.js";
import { expandInputs, type Input } from "../inputs.js";
import { convertedContent, convertInputs, inspectInputs, inspectProbe } from "../operations.js";
import { envelope, errorRecord, type Command, type Envelope, type Item } from "../output.js";
import { version } from "../version.js";
import { buildConversionWiring, buildWiring } from "../wiring.js";
import { importEngine } from "./engines.js";

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
];

class InvalidArguments extends Error {}

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

function toolResult(result: Envelope<unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}

async function convertTool(
  options: McpServerOptions,
  config: LoadedConfig | undefined,
  inputs: readonly Input[],
  format: ConversionFormat,
  pages: readonly number[] | undefined,
  signal: AbortSignal,
): Promise<Envelope<unknown>> {
  const wiring = await buildConversionWiring({ io: options.io, ...(config === undefined ? {} : { config }), flags: {} });
  for (const warning of wiring.warnings) options.io.diagnostic(`! ${warning}\n`);
  const records = new Array<Item<unknown> | undefined>(inputs.length);
  try {
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
  } finally {
    await wiring.dispose();
  }
  signal.throwIfAborted();
  return envelope("convert", records.filter((record) => record !== undefined));
}

async function inspectTool(
  options: McpServerOptions,
  config: LoadedConfig | undefined,
  inputs: readonly Input[],
  pages: readonly number[] | undefined,
  signal: AbortSignal,
): Promise<Envelope<unknown>> {
  const wiring = await buildWiring({
    io: options.io,
    ...(config === undefined ? {} : { config }),
    flags: {},
    needsModel: false,
    before: [inspectProbe({ text: false, lines: false, render: false })],
    ignoreSuppliedExtractor: true,
  });
  for (const warning of wiring.warnings) options.io.diagnostic(`! ${warning}\n`);
  const records: Item<unknown>[] = [];
  try {
    for await (const record of inspectInputs(wiring.extractor, inputs, options.io, pages === undefined ? {} : { pages }, signal)) {
      records.push(record);
    }
  } finally {
    await wiring.dispose();
  }
  return envelope("inspect", records);
}

/**
 * An MCP server with two model-free tools, `convert` and `inspect`. Connect it to
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

  // The high-level registerTool API only accepts Zod schemas; these handlers serve
  // the JSON Schemas above directly, so the CLI needs no Zod at run time.
  server.server.setRequestHandler(protocol.ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.server.setRequestHandler(protocol.CallToolRequestSchema, async (request, extra) => {
    const signal = options.signal === undefined ? extra.signal : AbortSignal.any([extra.signal, options.signal]);
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
      const config = await resolveConfig({
        cwd: options.io.cwd,
        ...(options.configPath === undefined ? {} : { explicit: options.configPath }),
        ...(options.noConfig === true ? { disabled: true } : {}),
      });
      const inputs = await expandInputs([call.source], options.io.cwd);
      return toolResult(
        call.tool === "inspect"
          ? await inspectTool(options, config, inputs, call.pages, signal)
          : await convertTool(options, config, inputs, call.format, call.pages, signal),
      );
    } catch (error) {
      signal.throwIfAborted();
      return toolResult(failedEnvelope(call.tool, call.source, error));
    }
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
  }
}
