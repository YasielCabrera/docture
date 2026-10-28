import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { errorCodeOf, silentLogger } from "docture";
import { documentFeatures } from "../../../src/core/pipeline/features.js";
import { DocumentLoaderAzureRead } from "../../../src/loaders/azure-di/index.js";

const first = "Invoice 😀 42";
const second = "Total 99";
const polygon = [1, 1, 2, 1, 2, 1.2, 1, 1.2];
const result = () => ({
  apiVersion: "2024-11-30", modelId: "prebuilt-read", stringIndexType: "utf16CodeUnit", content: `${first}\n${second}`,
  pages: [
    { pageNumber: 1, width: 8.5, height: 11, unit: "inch", angle: 0, spans: [{ offset: 0, length: first.length }], lines: [{ content: first, polygon, spans: [{ offset: 0, length: first.length }] }], words: [
      { content: "Invoice", polygon, confidence: 0.98, span: { offset: 0, length: 7 } },
      { content: "😀", polygon: [2, 1, 2.2, 1, 2.2, 1.2, 2, 1.2], confidence: 0.91, span: { offset: 8, length: 2 } },
      { content: "42", polygon: [2.3, 1, 2.6, 1, 2.6, 1.2, 2.3, 1.2], confidence: 0.87, span: { offset: 11, length: 2 } },
    ] },
    { pageNumber: 2, width: 8.5, height: 11, unit: "inch", angle: 0, spans: [{ offset: first.length + 1, length: second.length }], lines: [{ content: second, polygon, spans: [{ offset: first.length + 1, length: second.length }] }], words: [
      { content: "Total", polygon, confidence: 0.96, span: { offset: first.length + 1, length: 5 } },
      { content: "99", polygon: [2.3, 1, 2.6, 1, 2.6, 1.2, 2.3, 1.2], confidence: 0.94, span: { offset: first.length + 7, length: 2 } },
    ] },
  ],
});

async function server<T>(handler: (request: IncomingMessage, response: ServerResponse, origin: string) => void, action: (endpoint: string) => Promise<T>): Promise<T> {
  let origin = "";
  const http = createServer((request, response) => handler(request, response, origin));
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("Expected ephemeral TCP server");
  origin = `http://127.0.0.1:${address.port}`;
  try { return await action(origin); }
  finally { http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())); }
}

const ctx = () => ({ signal: new AbortController().signal, logger: silentLogger });
const raw = (mimeType = "application/pdf") => ({ bytes: new Uint8Array([37, 80, 68, 70]), mimeType });
const ok = (response: ServerResponse, data: unknown) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(data)); };

describe("Azure Read REST loading", () => {
  it("polls the pinned contract and maps UTF-16 word spans, confidence and inch geometry", async () => {
    const calls: { method: string | undefined; url: string; key: string | string[] | undefined; mime: string | undefined }[] = [];
    let polls = 0;
    await server((request, response, origin) => {
      calls.push({ method: request.method, url: request.url ?? "", key: request.headers["ocp-apim-subscription-key"], mime: request.headers["content-type"] });
      if (request.method === "POST") { response.writeHead(202, { "operation-location": `${origin}/documentintelligence/operations/one?api-version=2024-11-30` }); response.end(); }
      else ok(response, ++polls === 1 ? { status: "running" } : { status: "succeeded", analyzeResult: result() });
    }, async (endpoint) => {
      const loader = new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "secret-fixture" }, pollIntervalMs: 1 });
      const loaded = await loader.load(raw(), ctx());
      expect(loaded.text).toBe(`${first}\f${second}`);
      expect(loaded.pages.map((page) => [page.pageNumber, page.width, page.height])).toEqual([[1, 612, 792], [2, 612, 792]]);
      expect(loaded.pages[0]?.lines?.[0]?.spans.map((span) => [span.text, span.confidence])).toEqual([["Invoice", 0.98], ["😀", 0.91], ["42", 0.87]]);
      const span = loaded.pages[0]?.lines?.[0]?.spans[0];
      expect(span?.x).toBe(72);
      expect(span?.y).toBe(72);
      expect(span?.width).toBe(72);
      expect(span?.height).toBeCloseTo(14.4);
      expect(JSON.stringify(loaded.meta)).not.toContain("secret-fixture");
      expect(JSON.stringify(loaded.meta)).not.toContain(endpoint);
      expect(documentFeatures(loaded, loader, "application/pdf").hasGeometry).toBe(true);
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toContain("api-version=2024-11-30");
    expect(calls[0]?.url).toContain("stringIndexType=utf16CodeUnit");
    expect(calls.every((call) => call.key === "secret-fixture")).toBe(true);
    expect(calls[0]?.mime).toBe("application/pdf");
  });

  it("sends selected original pages and bearer auth, preserving their numbers", async () => {
    await server((request, response, origin) => {
      expect(request.headers.authorization).toBe("Bearer token-fixture");
      if (request.method === "POST") { expect(new URL(request.url ?? "", origin).searchParams.get("pages")).toBe("2"); response.writeHead(202, { "operation-location": `${origin}/op` }); response.end(); }
      else { const read = result(); read.pages = read.pages.filter((page) => page.pageNumber === 2); ok(response, { status: "succeeded", analyzeResult: read }); }
    }, async (endpoint) => {
      const loaded = await new DocumentLoaderAzureRead({ endpoint, auth: { kind: "bearer", token: "token-fixture" }, pollIntervalMs: 0 }).load(raw(), { ...ctx(), request: { pages: [2] } });
      expect(loaded.pages.map((page) => page.pageNumber)).toEqual([2]);
      expect(loaded.text).toBe(second);
    });
  });

  it.each(["image/png", "image/jpeg", "image/tiff"])("maps %s pixels only with caller-confirmed DPI and bounds rotated polygons", async (mime) => {
    await server((request, response, origin) => {
      if (request.method === "POST") { expect(request.headers["content-type"]).toBe(mime); response.writeHead(202, { "operation-location": `${origin}/op` }); response.end(); }
      else { const read = result(); read.pages = read.pages.slice(0, 1).map((page) => ({ ...page, unit: "pixel", width: 850, height: 1100, angle: 15, words: page.words.map((word) => ({ ...word, polygon: [10, 8, 22, 10, 20, 14, 8, 12] })) })); ok(response, { status: "succeeded", analyzeResult: read }); }
    }, async (endpoint) => {
      const scaled = await new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "k" }, pollIntervalMs: 0, imageDpi: 100 }).load(raw(mime), ctx());
      expect(scaled.pages[0]?.width).toBe(612);
      expect(scaled.pages[0]?.lines?.[0]?.spans[0]).toMatchObject({ x: 5.76, y: 5.76 });
      expect(scaled.pages[0]?.lines?.[0]?.spans[0]?.width).toBeCloseTo(10.08);
      const unscaled = await new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "k" }, pollIntervalMs: 0 }).load(raw(mime), ctx());
      expect(unscaled.pages[0]).toMatchObject({ width: 0, height: 0, text: first });
      expect(unscaled.pages[0]?.lines).toBeUndefined();
      expect(unscaled.meta).toMatchObject({ diagnostics: [{ pageNumber: 1, code: "PIXEL_DPI_REQUIRED" }] });
    });
  });

  it("retains text but omits missing geometry instead of fabricating line boxes", async () => {
    const read = result();
    const payload = { ...read, pages: read.pages.map((page) => ({ ...page, words: page.words.map(({ polygon: _polygon, ...word }) => word) })) };
    await server((request, response, origin) => {
      if (request.method === "POST") { response.writeHead(202, { "operation-location": `${origin}/op` }); response.end(); }
      else ok(response, { status: "succeeded", analyzeResult: payload });
    }, async (endpoint) => {
      const loader = new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "k" }, pollIntervalMs: 0 });
      const loaded = await loader.load(raw(), ctx());
      expect(loaded.text).toBe(`${first}\f${second}`);
      expect(loaded.pages.every((page) => page.lines === undefined)).toBe(true);
      expect(documentFeatures(loaded, loader, "application/pdf").hasGeometry).toBe(false);
    });
  });

  it.each(["http", "failed", "bad-json", "bad-span", "line-span", "cross-origin"])("reports %s failures without leaking credentials or endpoints", async (mode) => {
    await server((request, response, origin) => {
      if (request.method === "POST") { response.writeHead(mode === "http" ? 429 : 202, { "operation-location": mode === "cross-origin" ? "https://other.example/steal" : `${origin}/op` }); response.end(); }
      else if (mode === "bad-json") { response.end("not json"); }
      else if (mode === "bad-span") { const read = result(); read.pages[0]!.words[0]!.span.offset = 999; ok(response, { status: "succeeded", analyzeResult: read }); }
      else if (mode === "line-span") { const read = result(); read.pages[0]!.lines[0]!.spans = [{ offset: first.length + 1, length: second.length }]; ok(response, { status: "succeeded", analyzeResult: read }); }
      else ok(response, { status: "failed", error: { code: "InternalServerError", message: "secret remote details" } });
    }, async (endpoint) => {
      const failure: unknown = await new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "secret" }, pollIntervalMs: 0 }).load(raw(), ctx()).catch((error: unknown) => error);
      expect(errorCodeOf(failure)).toBe("LOAD_FAILED");
      expect(String(failure)).not.toContain(endpoint);
      expect(String(failure)).not.toContain("secret");
    });
  });

  it("bounds polling with a finite deadline and preserves caller cancellation", async () => {
    await server((request, response, origin) => {
      if (request.method === "POST") { response.writeHead(202, { "operation-location": `${origin}/op` }); response.end(); }
      else ok(response, { status: "running" });
    }, async (endpoint) => {
      const loader = new DocumentLoaderAzureRead({ endpoint, auth: { kind: "key", key: "k" }, pollIntervalMs: 1, timeoutMs: 30 });
      const failure: unknown = await loader.load(raw(), ctx()).catch((error: unknown) => error);
      expect(errorCodeOf(failure)).toBe("TIMEOUT");
      const controller = new AbortController(); const reason = new Error("caller cancelled Azure");
      controller.abort(reason);
      await expect(loader.load(raw(), { signal: controller.signal, logger: silentLogger })).rejects.toBe(reason);
    });
    expect(() => new DocumentLoaderAzureRead({ endpoint: "https://azure.example", auth: { kind: "key", key: "k" }, timeoutMs: Infinity })).toThrow();
  });
});
