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

async function connect(config = CONFIG) {
  const cwd = await tempDir("mcp-pages");
  await writeFile(join(cwd, "docture.config.mjs"), config);
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

  it("reports malformed pages as a USAGE tool error and a missing page as PAGE_OUT_OF_RANGE", async () => {
    const { client, server } = await connect();
    for (const pages of [[], [0], [1.5], "2"]) {
      const malformed = await client.callTool({ name: "convert", arguments: { source: "report.pdf", pages } });
      expect(malformed.isError).toBe(true);
      expect(resultOf(malformed)).toEqual({
        file: "report.pdf", ok: false, error: { code: "USAGE", message: "pages must be a non-empty array of one-based page numbers." },
      });
    }
    const missing = await client.callTool({ name: "convert", arguments: { source: "report.pdf", pages: [2, 5] } });
    expect(missing.isError).toBe(true);
    expect(resultOf(missing)).toMatchObject({
      file: "report.pdf",
      ok: false,
      error: { code: "PAGE_OUT_OF_RANGE", message: "Page 5 was not loaded. The loaded pages are 1-3." },
    });
    await server.close();
  });

  it("pages through long content with offset and maxChars until truncated is false", async () => {
    const { client, server } = await connect();
    const slices = [];
    for (let offset: number | undefined = 0; offset !== undefined;) {
      const result = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text", offset, maxChars: 20 } }));
      const { content, totalChars, truncated, nextOffset } = result;
      slices.push({ offset, content, totalChars, truncated, nextOffset });
      offset = result["nextOffset"] as number | undefined;
    }
    expect(slices).toEqual([
      { offset: 0, content: "Alpha page one.\fBeta", totalChars: 48, truncated: true, nextOffset: 20 },
      { offset: 20, content: " page two.\fGamma pag", totalChars: 48, truncated: true, nextOffset: 40 },
      { offset: 40, content: "e three.", totalChars: 48, truncated: false, nextOffset: undefined },
    ]);
    expect(resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text" } }))).toMatchObject({
      content: "Alpha page one.\fBeta page two.\fGamma page three.", offset: 0, totalChars: 48, truncated: false,
    });
    await server.close();
  });

  it("never ends a slice inside a surrogate pair", async () => {
    const { client, server } = await connect(CONFIG.replace('page(1, "Alpha page one.")', 'page(1, "ab\u{1F600}cd")'));
    const first = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text", pages: [1], maxChars: 3 } }));
    const second = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text", pages: [1], offset: 2, maxChars: 3 } }));
    expect([first["content"], first["nextOffset"], second["content"], second["nextOffset"]]).toEqual(["ab", 2, "\u{1F600}c", 5]);
    await server.close();
  });

  it("returns a whole surrogate pair when maxChars would cut it, and aligns an offset inside one", async () => {
    const { client, server } = await connect(CONFIG.replace('page(1, "Alpha page one.")', 'page(1, "Ab\u{1F600}cd")'));
    const slice = async (offset: number, maxChars: number) => {
      const { content, offset: start, nextOffset } = resultOf(await client.callTool({ name: "convert", arguments: { source: "report.pdf", format: "text", pages: [1], offset, maxChars } }));
      return [content, start, nextOffset];
    };
    expect(await slice(2, 1)).toEqual(["\u{1F600}", 2, 4]);
    expect(await slice(3, 1)).toEqual(["\u{1F600}", 2, 4]);
    expect(await slice(3, 3)).toEqual(["\u{1F600}c", 2, 5]);
    expect(await slice(4, 1)).toEqual(["c", 4, 5]);
    await server.close();
  });

  it("answers an unlisted tool name with a JSON-RPC error, even one that looks like a Paperless tool", async () => {
    const { client, server } = await connect();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["convert", "inspect", "extract"]);
    await expect(client.callTool({ name: "paperless_bogus", arguments: {} })).rejects.toThrow('Unknown tool "paperless_bogus".');
    await expect(client.callTool({ name: "paperless_read", arguments: { documentId: 1 } })).rejects.toThrow('Unknown tool "paperless_read".');
    await expect(client.callTool({ name: "list_schemas", arguments: {} })).rejects.toThrow('Unknown tool "list_schemas".');
    await server.close();
  });

  it("hints at a timeout with what an MCP client can do, not a CLI flag", async () => {
    const { client, server } = await connect(`import { createDocumentConverter } from "docture/node";
export default {
  converter: createDocumentConverter({
    timeoutMs: 50,
    loaders: [{ name: "slow", capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] }, load: () => new Promise(() => {}) }],
  }),
};`);
    const reply = await client.callTool({ name: "convert", arguments: { source: "report.pdf" } });
    expect(resultOf(reply)["error"]).toEqual({
      code: "TIMEOUT",
      message: '"call" exceeded its 50ms deadline.',
      hint: "A deadline in the server's docture.config.ts elapsed. Request fewer pages, or ask the server's operator to raise the deadline.",
    });
    await server.close();
  });
});
