import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DocumentLoaderData } from "docture";
import { captureIo } from "@docture/cli";
import { createHttpService } from "@docture/cli/service";

const data = new DocumentLoaderData();
let loaded = 0;
let disposed = 0;
const loader = Object.freeze({
  name: data.name, capabilities: data.capabilities,
  async load(...args: Parameters<typeof data.load>) { loaded += 1; return data.load(...args); },
  async dispose() { disposed += 1; },
});
const service = createHttpService({
  io: captureIo(), port: 0,
  config: { path: fileURLToPath(import.meta.url), config: {
    loaders: [loader],
    strategies: [{ name: "echo", async extract(context) { return { data: { text: context.document.text } }; } }],
  } },
  schemas: { note: z.object({ text: z.string() }) },
});
const address = await service.start();
const text = "A deterministic document served through three shared Docture operations.";
const document = { data: Buffer.from(text).toString("base64"), mimeType: "text/plain", fileName: "note.txt" };
try {
  for (const [route, options] of [["convert", { format: "text" }], ["inspect", {}], ["extract", { schema: "note" }]] satisfies readonly [string, object][]) {
    const response = await fetch(`${address.url}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document, ...options }) });
    assert.equal(response.status, 200);
    const result = z.object({ version: z.literal(1), command: z.literal(route), ok: z.literal(true), results: z.array(z.record(z.string(), z.unknown())) }).parse(await response.json());
    assert.equal(result.results.length, 1);
    if (route === "convert") assert.equal(result.results[0]?.["content"], text);
    if (route === "extract") assert.deepEqual(result.results[0]?.["data"], { text });
  }
  assert.equal(loaded, 3);
  assert.equal(disposed, 0);
} finally { await service.close(); }
assert.equal(disposed, 1);
console.log("HTTP convert, inspect and extract passed with one shared loader and exactly-once shutdown disposal.");
