import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { silentLogger } from "docture";
import { DocumentLoaderAzureRead } from "docture/loaders/azure-di";

let endpoint = "";
const server = createServer((request, response) => {
  assert.equal(request.headers["ocp-apim-subscription-key"], "mock-key");
  if (request.method === "POST") {
    response.writeHead(202, { "operation-location": `${endpoint}/operation` });
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "succeeded", analyzeResult: {
    apiVersion: "2024-11-30", modelId: "prebuilt-read", stringIndexType: "utf16CodeUnit", content: "Read locally",
    pages: [{ pageNumber: 1, width: 8.5, height: 11, unit: "inch", spans: [{ offset: 0, length: 12 }], lines: [{ content: "Read locally", spans: [{ offset: 0, length: 12 }] }], words: [
      { content: "Read", span: { offset: 0, length: 4 }, polygon: [1, 1, 2, 1, 2, 1.2, 1, 1.2], confidence: 0.95 },
      { content: "locally", span: { offset: 5, length: 7 }, polygon: [2.2, 1, 3.4, 1, 3.4, 1.2, 2.2, 1.2], confidence: 0.93 },
    ] }],
  } }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Expected ephemeral server");
endpoint = `http://127.0.0.1:${address.port}`;
try {
  const loader = new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "mock-key" }, pollIntervalMs: 0 });
  const document = await loader.load({ bytes: new TextEncoder().encode("%PDF-mock"), mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
  assert.equal(document.text, "Read locally");
  assert.equal(document.pages[0]?.width, 612);
  assert.equal(document.pages[0]?.lines?.[0]?.spans[0]?.x, 72);
  console.log("Azure Read mock polling and physical geometry passed.");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
