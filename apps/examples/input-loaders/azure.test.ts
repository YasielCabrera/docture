import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { runExample } from "./azure.js";

afterEach(() => vi.unstubAllEnvs());

it("sends the bundled PDF to Azure and reads the polled result", async () => {
  const invoice = await readFile(new URL("./invoice.pdf", import.meta.url));
  const content = "Larkspur Sample Supply Co. INV-2026-0142 $717.30";
  let uploaded = Buffer.alloc(0);
  let key: string | string[] | undefined;
  let endpoint = "";
  const server = createServer(async (request, response) => {
    key = request.headers["ocp-apim-subscription-key"];
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      uploaded = Buffer.concat(chunks);
      response.writeHead(202, { "operation-location": `${endpoint}/operation` });
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "succeeded", analyzeResult: {
      apiVersion: "2024-11-30", modelId: "prebuilt-read", stringIndexType: "utf16CodeUnit", content,
      pages: [{ pageNumber: 1, width: 8.5, height: 11, unit: "inch", spans: [{ offset: 0, length: content.length }],
        lines: [{ content, spans: [{ offset: 0, length: content.length }] }], words: [] }],
    } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Azure test server did not bind.");
  endpoint = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", endpoint);
  vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "test-key");
  try {
    const result = await runExample();
    expect(result.content).toBe(content);
    expect(uploaded).toEqual(invoice);
    expect(key).toBe("test-key");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
