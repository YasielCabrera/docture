import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createMcpServer, ENGINE_RANGES } from "../src/mcp/index.js";
import { importEngine } from "../src/mcp/engines.js";
import { serveStdio } from "../src/mcp/server.js";
import { captureIo, run } from "../src/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { cleanup, tempDir } from "./harness.js";

afterAll(cleanup);

async function documents(): Promise<string> {
  const cwd = await tempDir("mcp");
  await writeFile(join(cwd, "invoice.pdf"), (await makeInvoicePdf({ seed: 7 })).bytes);
  await writeFile(join(cwd, "broken.pdf"), "%PDF-1.7 this is not a document");
  return cwd;
}

async function connect(cwd: string, options: { readonly noConfig?: boolean } = { noConfig: true }) {
  const io = captureIo({ cwd });
  const server = await createMcpServer({ io, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, io };
}

interface Envelope {
  readonly version: number;
  readonly command: string;
  readonly ok: boolean;
  readonly results: readonly Record<string, unknown>[];
}

function envelopeOf(result: Record<string, unknown>): Envelope {
  const [text] = result["content"] as { type: string; text: string }[];
  expect(text?.type).toBe("text");
  const parsed = JSON.parse(text?.text ?? "") as Envelope;
  expect(result["structuredContent"]).toEqual(parsed);
  return parsed;
}

describe("the MCP server", () => {
  it("lists convert and inspect with JSON Schema inputs", async () => {
    const { client, server } = await connect(await documents());
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["convert", "inspect"]);
    expect(tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: {
        source: { type: "string", description: "A path relative to the server's working directory, an absolute path, or an http(s) or file: URL" },
        format: { type: "string", enum: ["markdown", "html", "text", "json"], default: "markdown" },
      },
      required: ["source"],
      additionalProperties: false,
    });
    expect(tools[1]?.inputSchema.required).toEqual(["source"]);
    expect(Object.keys(tools[1]?.inputSchema.properties ?? {})).toEqual(["source", "pages"]);
    await server.close();
  });

  it("inspects a PDF and returns the inspect envelope", async () => {
    const { client, server, io } = await connect(await documents());
    const result = await client.callTool({ name: "inspect", arguments: { source: "invoice.pdf" } });

    expect(result.isError).toBe(false);
    const envelope = envelopeOf(result);
    expect([envelope.version, envelope.command, envelope.ok]).toEqual([1, "inspect", true]);
    expect(envelope.results[0]).toMatchObject({ file: "invoice.pdf", ok: true, loader: "pdfjs", features: { pageCount: 1 } });
    expect(io.stdout).toBe("");
    await server.close();
  });

  it("converts a PDF to Markdown and to JSON without writing files", async () => {
    const { client, server } = await connect(await documents());

    const markdown = envelopeOf(await client.callTool({ name: "convert", arguments: { source: "invoice.pdf" } }));
    expect([markdown.command, markdown.ok]).toEqual(["convert", true]);
    expect(markdown.results[0]).toMatchObject({ file: "invoice.pdf", ok: true, format: "markdown", mimeType: "text/markdown", pageCount: 1 });
    expect(markdown.results[0]?.["content"]).toContain("INV-2026-4311");

    const json = envelopeOf(await client.callTool({ name: "convert", arguments: { source: "invoice.pdf", format: "json" } }));
    expect(json.results[0]).toMatchObject({ format: "json", mimeType: "application/json" });
    expect(JSON.parse(String(json.results[0]?.["content"])).schemaVersion).toBe(2);
    await server.close();
  });

  it("reports a damaged document as a tool error with the CLI error code", async () => {
    const { client, server } = await connect(await documents());
    const result = await client.callTool({ name: "inspect", arguments: { source: "broken.pdf" } });

    expect(result.isError).toBe(true);
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.results[0]).toMatchObject({ file: "broken.pdf", ok: false, error: { code: "LOAD_FAILED" } });
    await server.close();
  });

  it("reports a converter factory that throws, or returns no converter, as a tool error envelope", async () => {
    const cwd = await documents();
    await writeFile(join(cwd, "docture.config.mjs"), 'export default { converter: () => { throw new Error("factory boom"); } };');
    const throwing = await connect(cwd, {});
    const thrown = await throwing.client.callTool({ name: "convert", arguments: { source: "invoice.pdf" } });
    await throwing.server.close();

    expect(thrown.isError).toBe(true);
    expect(envelopeOf(thrown).results).toEqual([{ file: "invoice.pdf", ok: false, error: { code: "INTERNAL", message: "factory boom" } }]);

    const other = await documents();
    await writeFile(join(other, "docture.config.mjs"), "export default { converter: () => 5 };");
    const invalid = await connect(other, {});
    const returned = await invalid.client.callTool({ name: "convert", arguments: { source: "invoice.pdf" } });
    await invalid.server.close();

    expect(returned.isError).toBe(true);
    expect(envelopeOf(returned).results[0]).toMatchObject({ file: "invoice.pdf", ok: false, error: { code: "USAGE" } });
  });

  it("rejects stdin and malformed arguments as invalid parameters", async () => {
    const { client, server } = await connect(await documents());

    await expect(client.callTool({ name: "convert", arguments: { source: "-" } })).rejects.toThrow("stdin");
    await expect(client.callTool({ name: "inspect", arguments: {} })).rejects.toThrow("source");
    await expect(client.callTool({ name: "inspect", arguments: { source: "invoice.pdf", pages: [0] } })).rejects.toThrow("pages");
    await expect(client.callTool({ name: "convert", arguments: { source: "invoice.pdf", format: "docx" } })).rejects.toThrow("format");
    await server.close();
  });

  it("writes only JSON-RPC frames to stdout and stops at end of input", async () => {
    const cwd = await documents();
    const io = captureIo({ cwd });
    const stdin = new PassThrough();
    const frames = () => io.stdout.split("\n").filter(Boolean);

    const serving = serveStdio({ io, noConfig: true, stdin });
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "inspect", arguments: { source: "invoice.pdf" } } },
    ];
    for (const request of requests) stdin.write(`${JSON.stringify(request)}\n`);
    await expect.poll(() => frames().length, { timeout: 10_000 }).toBe(2);
    stdin.end();
    await serving;

    const replies = frames().map((line) => JSON.parse(line) as { jsonrpc: string; id: number; result: { isError: boolean } });
    expect(replies.map((reply) => [reply.jsonrpc, reply.id])).toEqual([["2.0", 1], ["2.0", 2]]);
    expect(replies[1]?.result.isError).toBe(false);
    expect(io.stdout.endsWith("\n")).toBe(true);
  });

  it("keeps the bin's stdout to JSON-RPC frames when serving over a real process", async () => {
    const cwd = await documents();
    const tsx = createRequire(new URL("../../../apps/docs/package.json", import.meta.url)).resolve("tsx/esm");
    const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", tsx, bin, "mcp", "--no-config"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));

    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "inspect", arguments: { source: "invoice.pdf" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "convert", arguments: { source: "broken.pdf" } } },
    ];
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    await expect.poll(() => stdout.split("\n").filter(Boolean).length, { timeout: 20_000 }).toBe(3);
    child.stdin.end();

    expect(await exited, stderr).toBe(0);
    expect(stdout.endsWith("\n")).toBe(true);
    const replies = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { jsonrpc: string; id: number; result: Record<string, unknown> })
      .sort((a, b) => a.id - b.id);
    expect(replies.map((reply) => [reply.jsonrpc, reply.id])).toEqual([["2.0", 1], ["2.0", 2], ["2.0", 3]]);
    expect(replies.map((reply) => reply.result["isError"])).toEqual([undefined, false, true]);
    expect(envelopeOf(replies[2]?.result ?? {}).results[0]).toMatchObject({ file: "broken.pdf", ok: false, error: { code: "LOAD_FAILED" } });
  }, 30_000);

  it("names the optional SDK peer and its pinned range when it is missing", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      peerDependencies: Record<string, string>;
    };
    expect(ENGINE_RANGES).toEqual({ "@modelcontextprotocol/sdk": manifest.peerDependencies["@modelcontextprotocol/sdk"] });

    const absent = Object.assign(new Error("Cannot find package '@modelcontextprotocol/sdk' imported from /app/x.js"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    await expect(importEngine(() => Promise.reject(absent))).rejects.toThrow(
      `@docture/cli/mcp needs the optional peer @modelcontextprotocol/sdk@${ENGINE_RANGES["@modelcontextprotocol/sdk"]}, which is not installed.`,
    );
  });

  it("documents how to register the server", async () => {
    const io = captureIo();
    expect(await run(["mcp", "--help"], { io })).toBe(0);
    expect(io.stdout).toContain('"command": "npx"');
    expect(io.stdout).toContain('"args": ["docture", "mcp"]');
  });
});
