import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/index.js";
import { captureIo } from "../src/index.js";
import { cleanup, tempDir } from "./harness.js";

afterAll(cleanup);

const CONFIG = `import { appendFileSync } from "node:fs";
const page = (pageNumber, text) => {
  const line = { y: 100, height: 12, text, spans: [{ text, x: 40, y: 100, width: 120, height: 12, style: { fontSize: 11 } }] };
  return { pageNumber, width: 600, height: 800, text, lines: [line] };
};
const pages = [page(1, "Alpha page one."), page(2, "Beta page two."), page(3, "Gamma page three.")];
export default {
  loaders: [{
    name: "spy",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] },
    async load(_raw, ctx) {
      appendFileSync(new URL("./requests.log", import.meta.url), JSON.stringify(ctx.request ?? null) + "\\n");
      return { pages, text: pages.map((p) => p.text).join("\\f"), form: "digital", loader: "spy" };
    },
  }],
};
`;

async function connect() {
  const cwd = await tempDir("mcp-pages");
  await writeFile(join(cwd, "docture.config.mjs"), CONFIG);
  await writeFile(join(cwd, "report.pdf"), "%PDF-1.7 pretend");
  const server = await createMcpServer({ io: captureIo({ cwd }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const requests = async () => (await readFile(join(cwd, "requests.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  return { client, server, requests };
}

function resultOf(reply: Record<string, unknown>): Record<string, unknown> {
  const envelope = reply["structuredContent"] as { results: Record<string, unknown>[] };
  return envelope.results[0] ?? {};
}

describe("the MCP convert tool's pages argument", () => {
  it("advertises pages in the convert input schema", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "convert")?.inputSchema.properties?.["pages"]).toEqual({
      type: "array",
      items: { type: "integer", minimum: 1 },
      minItems: 1,
      description: "One-based page numbers to convert, keeping their original numbers. Default: every page",
    });
    await server.close();
  });

  it("reads and converts only the selected pages, keeping their original numbers", async () => {
    const { client, server, requests } = await connect();
    const json = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "json", pages: [2] } }));
    expect(json).toMatchObject({ ok: true, format: "json", pageCount: 1 });
    const document = JSON.parse(String(json["content"])) as { pages: { pageNumber: number; elements: { text?: string }[] }[] };
    expect(document.pages.map((page) => [page.pageNumber, page.elements.map((element) => element.text)])).toEqual([[2, ["Beta page two."]]]);

    const gap = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text", pages: [3, 1] } }));
    expect(gap["content"]).toBe("Alpha page one.\fGamma page three.");
    const consecutive = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", pages: [2, 3] } }));
    expect(consecutive["content"]).toBe("<!-- page: 2 -->\n\nBeta page two.\n\n<!-- page: 3 -->\n\nGamma page three.");

    expect(await requests()).toEqual([
      { pages: [2], layout: true, assets: false },
      { pages: [3, 1], layout: true, assets: false },
      { pages: [2, 3], layout: true, assets: false },
    ]);
    await server.close();
  });

  it("rejects malformed pages as invalid parameters and a missing page as PAGE_OUT_OF_RANGE", async () => {
    const { client, server } = await connect();
    for (const pages of [[], [0], [1.5], "2"]) {
      await expect(client.callTool({ name: "convert", arguments: { source: "report.pdf", pages } }))
        .rejects.toThrow("pages must be a non-empty array of one-based page numbers.");
    }
    const missing = await client.callTool({ name: "convert", arguments: { source: "report.pdf", pages: [2, 5] } });
    expect(missing.isError).toBe(true);
    expect(resultOf(missing)).toMatchObject({
      file: "report.pdf",
      ok: false,
      error: { code: "PAGE_OUT_OF_RANGE", message: "Pages 5 do not exist. The document has 3 pages." },
    });
    await server.close();
  });
});
