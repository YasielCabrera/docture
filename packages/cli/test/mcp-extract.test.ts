import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, expect, it } from "vitest";
import { captureIo } from "../src/index.js";
import { createMcpServer } from "../src/mcp/index.js";
import { cleanup, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

it("MCP extraction uses allowlisted caller schemas and returns full native evidence without config override", async () => {
  const cwd = await tempDir("mcp-configured-extract");
  await writeFixture(cwd, "docture.config.mjs", `import {z} from "zod";
    import {appendFileSync} from "node:fs";
    let disposed = false;
    import {importDoclingDocument} from "docture/import/docling";
    export default {
      schemas:{report:z.object({subject:z.string()}),letter:z.object({recipient:z.string()})},
      loaders:[{name:"native-json",capabilities:{text:true,geometry:false,images:false,mimeTypes:["application/json"]},async dispose(){disposed=true;appendFileSync(new URL("./disposed.log",import.meta.url),"disposed\\n");},async load(raw){if(disposed)throw new Error("loader already disposed");return importDoclingDocument(JSON.parse(new TextDecoder().decode(raw.bytes))).source.loaded;}}],
      strategies:[{name:"native",async extract(ctx){const evidence=ctx.document.pages.flatMap(page=>page.evidence??[])[0];const key=Object.hasOwn(ctx.schema.jsonSchema.properties,"subject")?"subject":"recipient";return {data:{[key]:evidence.text},citations:[{path:[key],status:"verified",ids:[evidence.id],value:evidence.text}]};}}]
    };`);
  const document = (text: string) => ({ schema_name: "DoclingDocument", version: "1.10.0", name: "native", body: { self_ref: "#/body", children: [{ $ref: "#/texts/0" }] }, furniture: { self_ref: "#/furniture", children: [] }, pages: {}, texts: [{ self_ref: "#/texts/0", label: "text", text, prov: [] }], tables: [], pictures: [], groups: [] });
  await writeFixture(cwd, "report.json", JSON.stringify(document("Pressure report")));
  await writeFixture(cwd, "letter.json", JSON.stringify(document("Ada")));
  const io = captureIo({ cwd });
  const server = await createMcpServer({ io });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "extraction-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    for (const [schemaName, key, value] of [["report", "subject", "Pressure report"], ["letter", "recipient", "Ada"]]) {
      const response = await client.callTool({ name: "extract", arguments: { source: `${schemaName}.json`, schemaName } });
      expect(response.isError).toBe(false);
      const serialized = JSON.stringify(response.structuredContent);
      expect(serialized).toContain('"sourceDigest":"sha256:');
      expect(serialized).toContain("#/texts/0");
      expect(response.structuredContent).toMatchObject({ version: 1, command: "extract", ok: true, results: [{ data: { [key ?? ""]: value }, citations: [{ path: key, status: "verified" }], citationSources: [], evidenceSources: [{ text: value, granularity: "element", location: { kind: "logical" } }] }] });
    }
    await expect(client.callTool({ name: "extract", arguments: { source: "report.json", schemaName: "constructor" } })).rejects.toThrow("configured schema");
    await expect(client.callTool({ name: "extract", arguments: { source: "report.json", schemaName: "report", model: "untrusted/model" } })).rejects.toThrow("Unknown argument");
    expect(io.stdout).toBe("");
    await expect(readFile(join(cwd,"disposed.log"),"utf8")).rejects.toThrow();
  } finally {
    await client.close();
    await server.close();
  }
  expect(await readFile(join(cwd,"disposed.log"),"utf8")).toBe("disposed\n");
});

it("MCP reports a configuration error once and still shuts down normally", async () => {
  const cwd = await tempDir("mcp-bad-config-close");
  await writeFixture(cwd, "docture.config.mjs", 'throw new Error("Invalid owner configuration");');
  const server = await createMcpServer({ io: captureIo({ cwd }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "config-error-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const response = await client.callTool({ name: "extract", arguments: { source: "note.txt" } });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.structuredContent)).toContain("Invalid owner configuration");
  } finally {
    await client.close();
    await expect(server.close()).resolves.toBeUndefined();
  }
});

it("MCP rejects an unconfigured schema before constructing the extraction pipeline", async () => {
  const cwd = await tempDir("mcp-schema-boundary");
  await writeFixture(cwd, "docture.config.mjs", `import { z } from "zod";
    export default { schemas: { note: z.object({ text: z.string() }) }, extractor() { throw new Error("Unselected pipeline must not be constructed"); } };`);
  const server = await createMcpServer({ io: captureIo({ cwd }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-boundary-test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await expect(client.callTool({ name: "extract", arguments: { source: "note.txt", schemaName: "missing" } })).rejects.toThrow("configured schema");
  } finally {
    await client.close();
    await server.close();
  }
});
