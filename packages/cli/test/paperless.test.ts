import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/index.js";
import { captureIo } from "../src/index.js";
import type { PaperlessPlan, PaperlessApplyResult } from "docture/sinks/paperless";
import { cleanup, cli, tempDir } from "./harness.js";

afterAll(cleanup);
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });

async function fixture(enableApply = false, apiVersion: 9 | 10 = 10) {
  const fields = new Map<string, string>(); const tags = new Set<number>([2]); const notes: { id: number; note: string }[] = []; let writes = 0;
  const document = (id: number) => ({ id, root_document: null, title: id === 42 ? "Invoice" : "Report", content: id === 42 ? "Invoice INV-42 describes an ordinary supplier transaction. This exact complete text is the configured source for the invoice schema." : "Quarterly report covers the operating results. This exact complete text is the configured source for a distinct report schema.", tags: [...tags], custom_fields: [...fields].map(([field, value]) => ({ field: Number(field), value })), correspondent: null, document_type: null, user_can_change: true, versions: [{ id, is_root: true, checksum: `file-${id}`, added: "2026-01-01" }] });
  const server = createServer(async (request, response) => {
    response.setHeader("X-Version", "3.3.4"); response.setHeader("X-Api-Version", String(apiVersion)); response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== "Token server-config-secret") { response.statusCode = 401; response.end("{}"); return; }
    const url = new URL(request.url ?? "", "http://local");
    if (request.method === "POST") {
      writes++; const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (url.pathname.endsWith("notes/")) { notes.push({ id: notes.length + 1, note: body.note }); response.end(JSON.stringify(notes)); return; }
      if (body.method === "modify_custom_fields") { expect(body.parameters.remove_custom_fields).toEqual([]); for (const [field, value] of Object.entries(body.parameters.add_custom_fields)) fields.set(field, String(value)); }
      if (body.method === "add_tag") tags.add(body.parameters.tag);
      response.end('{"result":"OK"}'); return;
    }
    if (url.pathname.endsWith("custom_fields/")) { response.end(JSON.stringify({ count: 2, next: null, results: [{ id: 1, name: "Invoice ID", data_type: "string", extra_data: {} }, { id: 2, name: "Subject", data_type: "string", extra_data: {} }] })); return; }
    if (url.pathname.endsWith("tags/")) { response.end(JSON.stringify({ count: 2, next: null, results: [{ id: 2, name: "Existing" }, { id: 3, name: "Extracted" }] })); return; }
    if (url.pathname.endsWith("notes/")) { response.end(JSON.stringify(notes)); return; }
    if (url.pathname === "/api/documents/") { response.end(JSON.stringify({ count: 2, next: null, results: [{ id: 42, content: "snippet" }, { id: 44, content: "snippet" }] })); return; }
    response.end(JSON.stringify(document(Number(url.pathname.split("/").at(-2)))));
  });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (address === null || typeof address === "string") throw new Error("no address");
  const cwd = await tempDir("paperless-cli");
  const config = `import { appendFileSync } from "node:fs";
import { DocumentLoaderData } from "docture";
import { llm } from "docture/llm/text";
import { jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
const model = new MockLanguageModelV4({ doGenerate: async (options) => {
  appendFileSync(new URL('./model-calls.log', import.meta.url), 'call\\n');
  const report = JSON.stringify(options.responseFormat).includes('subject');
  return { content:[{type:'text',text:JSON.stringify(report ? {subject:'Quarterly report'} : {invoiceId:'INV-42'})}], finishReason:{unified:'stop',raw:'stop'}, usage:{inputTokens:{total:10,noCache:10,cacheRead:0,cacheWrite:0},outputTokens:{total:5,text:5,reasoning:0}},warnings:[] };
}});
const contract = (name) => jsonSchema({type:'object',properties:{[name]:{type:'string'}},required:[name],additionalProperties:false});
export default { loaders:[new DocumentLoaderData()], strategies:[llm({model,citations:true,maxRetries:0,completion:'forbidden'})], paperless:{connection:{baseUrl:${JSON.stringify(`http://127.0.0.1:${address.port}/`)},apiVersion:${apiVersion},token:'server-config-secret'},enableApply:${enableApply},maxResults:2,schemas:{invoice:{contract:contract('invoiceId'),source:{mode:'content'},mappingId:'invoice-v1',fields:[{path:['invoiceId'],fieldId:1}],evidence:'any',tagIds:[3],auditNote:'Docture invoice'},report:{contract:contract('subject'),source:{mode:'content'},mappingId:'report-v1',fields:[{path:['subject'],fieldId:2}],evidence:'any'}}}};`;
  await writeFile(join(cwd, "docture.config.mjs"), config);
  return { cwd, fields, tags, notes, writes: () => writes };
}

interface ReplyRecord { readonly text?: string; readonly data?: unknown; readonly plan?: PaperlessPlan; readonly apply?: PaperlessApplyResult }
interface Reply { readonly results: ReplyRecord[]; readonly ok: boolean }
function data(stdout: string): Reply { return JSON.parse(stdout); }
async function connected(cwd: string) {
  const io = captureIo({ cwd }); const server = await createMcpServer({ io });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "paperless-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]); return { io, client, server };
}
function structured(value: Record<string, unknown>): Reply { return value.structuredContent as Reply; }

describe("Paperless CLI and MCP", () => {
  it.each([9, 10] as const)("reads, searches and extracts two configured schemas using real mock-provider calls through API %i", async (version) => {
    const f = await fixture(false, version);
    const read = await cli(["paperless", "read", "42"], { cwd: f.cwd }); expect(read.code, read.stderr).toBe(0); expect(data(read.stdout).results[0]?.text).toContain("Invoice INV-42");
    const search = await cli(["paperless", "search", "--query", "document", "--limit", "1"], { cwd: f.cwd }); expect(search.code, search.stderr).toBe(0); expect(data(search.stdout).results).toHaveLength(1);
    const invoice = await cli(["paperless", "extract", "42", "--schema", "invoice"], { cwd: f.cwd }); expect(invoice.code, invoice.stderr).toBe(0); expect(data(invoice.stdout).results[0]).toMatchObject({ data: { invoiceId: "INV-42" }, source: { documentId: 42, fileVersionId: 42, apiVersion: version }, validation: { valid: true }, citations: [{ path: "invoiceId", status: "uncited" }] });
    const report = await cli(["paperless", "extract", "44", "--schema", "report"], { cwd: f.cwd }); expect(report.code, report.stderr).toBe(0); expect(data(report.stdout).results[0]?.data).toEqual({ subject: "Quarterly report" });
    expect((await readFile(join(f.cwd, "model-calls.log"), "utf8")).trim().split("\n")).toHaveLength(2); expect(f.writes()).toBe(0);
    expect(invoice.stdout).not.toContain("server-config-secret");
  });

  it("reuses a configured singleton extractor across MCP calls and disposes it once on close", async () => {
    const f = await fixture();
    const path = join(f.cwd, "docture.config.mjs");
    const config = await readFile(path, "utf8");
    await writeFile(path, 'import {createExtractor} from "docture/node";\n' + config.replace("export default ", "const config = ") + `
      let disposed=false;
      const extractor=createExtractor(config);
      const extract=extractor.extract.bind(extractor);
      extractor.extract=(...args)=>{if(disposed)throw new Error("singleton already disposed");return extract(...args);};
      const dispose=extractor.dispose.bind(extractor);
      extractor.dispose=async(scope)=>{disposed=true;appendFileSync(new URL('./disposed.log',import.meta.url),'disposed\\n');await dispose(scope);};
      config.extractor=extractor;
      export default config;`);
    const { client, server } = await connected(f.cwd);
    try {
      for (let call=0;call<2;call++) {
        const response = await client.callTool({name:"paperless_extract",arguments:{documentId:42,schemaName:"invoice"}});
        expect(response.isError).toBe(false);
        expect(response.structuredContent).toMatchObject({ok:true,results:[{data:{invoiceId:"INV-42"}}]});
      }
      await expect(readFile(join(f.cwd,"disposed.log"),"utf8")).rejects.toThrow();
    } finally { await client.close(); await server.close(); }
    expect(await readFile(join(f.cwd,"disposed.log"),"utf8")).toBe("disposed\n");
  });

  it("prints plans and dry runs without writes, applies explicitly and preserves co-writers on repeats", async () => {
    const f = await fixture();
    const planned = await cli(["paperless", "plan", "42", "--schema", "invoice", "--dry-run", "--out", "plan.json"], { cwd: f.cwd }); expect(planned.code, planned.stderr).toBe(0); expect(f.writes()).toBe(0);
    const preview = await cli(["paperless", "apply", "plan.json", "--schema", "invoice", "--dry-run"], { cwd: f.cwd }); expect(preview.code, preview.stderr).toBe(0); expect(f.writes()).toBe(0);
    f.fields.set("1", "human edit");
    const applied = await cli(["paperless", "apply", "plan.json", "--schema", "invoice"], { cwd: f.cwd }); expect(applied.code, applied.stderr).toBe(0);
    expect(data(applied.stdout).results[0]?.apply?.outcomes[0]).toMatchObject({ status: "skipped", current: "human edit", reason: expect.stringContaining("nonempty") });
    expect(f.fields.get("1")).toBe("human edit"); expect([...f.tags]).toEqual([2, 3]); expect(f.notes).toHaveLength(1);
    const repeated = await cli(["paperless", "apply", "plan.json", "--schema", "invoice"], { cwd: f.cwd }); expect(repeated.code, repeated.stderr).toBe(0); expect(f.notes).toHaveLength(1); expect(f.writes()).toBe(2);
  });

  it("lists MCP plans by default and rejects apply calls without configuration enablement", async () => {
    const f = await fixture(); const { io, client, server } = await connected(f.cwd);
    try {
      const tools = await client.listTools(); expect(tools.tools.map((tool) => tool.name)).toContain("paperless_plan"); expect(tools.tools.map((tool) => tool.name)).not.toContain("paperless_apply");
      const planned = structured(await client.callTool({ name: "paperless_plan", arguments: { documentId: 42, schemaName: "invoice" } })); expect(planned.ok).toBe(true); expect(planned.results[0]?.plan?.source.fileVersionId).toBe(42); expect(f.writes()).toBe(0);
      const disabled = await client.callTool({ name: "paperless_apply", arguments: { schemaName: "invoice", plan: planned.results[0]?.plan } }); expect(disabled.isError).toBe(true); expect(f.writes()).toBe(0); expect(io.stdout).toBe("");
    } finally { await server.close(); }
  });

  it("uses named schema/provider pipelines through MCP and enables only configured apply", async () => {
    const f = await fixture(true); const { io, client, server } = await connected(f.cwd);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("paperless_apply");
      const invoice = structured(await client.callTool({ name: "paperless_extract", arguments: { documentId: 42, schemaName: "invoice" } })); expect(invoice.results[0]?.data).toEqual({ invoiceId: "INV-42" });
      const report = structured(await client.callTool({ name: "paperless_extract", arguments: { documentId: 44, schemaName: "report" } })); expect(report.results[0]?.data).toEqual({ subject: "Quarterly report" });
      const planned = structured(await client.callTool({ name: "paperless_plan", arguments: { documentId: 42, schemaName: "invoice" } }));
      const applied = structured(await client.callTool({ name: "paperless_apply", arguments: { schemaName: "invoice", plan: planned.results[0]?.plan } })); expect(applied.ok).toBe(true); expect(f.fields.get("1")).toBe("INV-42");
      const escaped = await client.callTool({ name: "paperless_extract", arguments: { documentId: 42, schemaName: "invoice", token: "override", baseUrl: "https://foreign.test" } }); expect(escaped.isError).toBe(true);
      expect(io.stdout).toBe("");
    } finally { await server.close(); }
  });

  it("refuses output aliases before model calls or writes", async () => {
    const f = await fixture(); const before = await readFile(join(f.cwd, "docture.config.mjs"), "utf8");
    const result = await cli(["paperless", "plan", "42", "--schema", "invoice", "--out", "docture.config.mjs"], { cwd: f.cwd });
    expect(result.code).toBe(2); expect(result.stderr).toContain("overwrite input"); expect(await readFile(join(f.cwd, "docture.config.mjs"), "utf8")).toBe(before); expect(f.writes()).toBe(0);
  });
});

it("bounds omitted query limits by the owner's configured maximum across CLI and MCP", async () => {
  const f = await fixture();
  for (const action of ["search", "extract", "plan"]) {
    const args = ["paperless", action, "--query", "document", ...(action === "search" ? [] : ["--schema", "invoice"])];
    const response = await cli(args, { cwd: f.cwd });
    expect(response.code, response.stderr).toBe(0);
    expect(data(response.stdout).results).toHaveLength(2);
  }
  const { client, server } = await connected(f.cwd);
  try {
    const listed = await client.listTools();
    for (const name of ["paperless_search", "paperless_extract", "paperless_plan"]) {
      expect(listed.tools.find((tool) => tool.name === name)?.inputSchema.properties?.["limit"]).toMatchObject({ maximum: 2, default: 2 });
      const response = await client.callTool({ name, arguments: { query: "document", ...(name === "paperless_search" ? {} : { schemaName: "invoice" }) } });
      expect(response.isError).toBe(false);
      expect(structured(response).results).toHaveLength(2);
    }
    const excessive = await client.callTool({ name: "paperless_search", arguments: { query: "document", limit: 3 } });
    expect(excessive.isError).toBe(true);
    expect(f.writes()).toBe(0);
  } finally {
    await client.close();
    await server.close();
  }
});

it("MCP validates a Paperless schema before constructing the extraction pipeline", async () => {
  const f = await fixture();
  const path = join(f.cwd, "docture.config.mjs");
  const config = await readFile(path, "utf8");
  await writeFile(path, config.replace("export default {", 'export default { extractor() { throw new Error("Unselected pipeline must not be constructed"); },'));
  const { client, server } = await connected(f.cwd);
  try {
    for (const name of ["paperless_extract", "paperless_plan"]) {
      const response = await client.callTool({ name, arguments: { documentId: 42, schemaName: "missing" } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response.structuredContent)).toContain("Unknown configured Paperless schema");
    }
    expect(f.writes()).toBe(0);
  } finally {
    await client.close();
    await server.close();
  }
});
