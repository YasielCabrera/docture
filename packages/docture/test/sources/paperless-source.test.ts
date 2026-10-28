import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PaperlessSource, PaperlessError } from "../../src/sources/paperless/index.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });

async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const instance = createServer((request, response) => { response.setHeader("X-Version", "3.3.4"); response.setHeader("X-Api-Version", request.headers.accept?.includes("version=9") ? "9" : "10"); handler(request, response); });
  servers.push(instance); instance.listen(0, "127.0.0.1"); await once(instance, "listening");
  const address = instance.address(); if (address === null || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}/paperless/`;
}
const doc = (id = 42) => ({ id, root_document: null, title: `Document ${id}`, content: "Exact full text\fwith logical separator", tags: [2], custom_fields: [{ field: 1, value: false }], correspondent: null, document_type: null, versions: [{ id: 43, is_root: false, checksum: "new", added: "2026-01-02" }, { id: 42, is_root: true, checksum: "old", added: "2026-01-01" }] });
const metadata = { has_archive_version: true, original_mime_type: "application/pdf", original_checksum: "native-original", archive_checksum: "native-archive", original_filename: "source.pdf", archive_media_filename: "archive.pdf" };
const pdf = new TextEncoder().encode("%PDF-1.7\nexact archive bytes");
function json(response: ServerResponse, value: unknown) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); }

describe("Paperless versioned sources", () => {
  it.each([9, 10] as const)("reads exact selected-version content and archive through API %i", async (apiVersion) => {
    const requests: string[] = [];
    const baseUrl = await server((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      expect(request.headers.authorization).toBe("Token test-token"); expect(request.headers.accept).toContain(`version=${apiVersion}`);
      const url = new URL(request.url ?? "", "http://local");
      if (url.pathname.endsWith("metadata/")) { expect(url.searchParams.get("version")).toBe("42"); return json(response, metadata); }
      if (url.pathname.endsWith("download/")) { expect(url.searchParams.get("version")).toBe("42"); response.setHeader("content-type", "application/pdf"); return response.end(pdf); }
      expect(url.searchParams.get("truncate_content")).toBe("false"); return json(response, doc());
    });
    const source = new PaperlessSource({ baseUrl, token: "test-token", apiVersion });
    const content = await source.read(42, { mode: "content", versionId: 42 });
    expect("loaded" in content.source && content.source.loaded.text).toBe(doc().content);
    expect("loaded" in content.source && content.source.loaded.pages).toEqual([{ pageNumber: 1, width: 0, height: 0, text: doc().content }]);
    expect(content.provenance).toMatchObject({ documentId: 42, fileVersionId: 42, variant: "content", apiVersion, serverVersion: "3.3.4", digest: createHash("sha256").update(doc().content).digest("hex") });
    expect(Object.isFrozen(content.provenance.metadata)).toBe(true);
    expect(content.provenance.metadata).not.toHaveProperty("content");
    const archive = await source.read(42, { mode: "archive", versionId: 42 });
    expect("bytes" in archive.source && archive.source.bytes).toEqual(pdf);
    expect(archive.provenance.digest).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(archive.provenance.metadata.customFields).toEqual([{ field: 1, value: false }]);
    expect(requests.every((value) => value.startsWith("GET "))).toBe(true);
  });

  it("bounds query pagination and refetches full detail instead of search highlights", async () => {
    const seen: string[] = [];
    const baseUrl = await server((request, response) => {
      seen.push(request.url ?? "");
      const url = new URL(request.url ?? "", "http://local");
      if (url.pathname.endsWith("documents/")) return json(response, { count: 3, next: "?page=2", results: [{ id: 42, content: "truncated", __search_hit__: { highlights: "snippet" } }, { id: 44 }] });
      return json(response, doc(Number(url.pathname.split("/").at(-2))));
    });
    const source = new PaperlessSource({ baseUrl, token: "test-token", apiVersion: 10 });
    const results = []; for await (const value of source.query({ query: "needle", limit: 1, mode: "content" })) results.push(value);
    expect(results).toHaveLength(1); expect("loaded" in results[0]!.source && results[0]!.source.loaded.text).toBe(doc().content);
    expect(seen).toHaveLength(3); expect(seen[0]).toContain("query=needle");
  });

  it("rejects untrusted pagination and redirects before sending credentials", async () => {
    const calls: string[] = [];
    const baseUrl = await server((request, response) => { calls.push(request.url ?? ""); json(response, { count: 1, next: "https://foreign.test/api/documents/", results: [] }); });
    const source = new PaperlessSource({ baseUrl, token: "test-token", apiVersion: 10 });
    await expect((async () => { for await (const _value of source.query({ limit: 2, mode: "content" })) {} })()).rejects.toBeInstanceOf(PaperlessError);
    expect(calls).toHaveLength(1);
    const redirectUrl = await server((_request, response) => { response.writeHead(302, { location: "https://foreign.test/private" }); response.end(); });
    await expect(new PaperlessSource({ baseUrl: redirectUrl, token: "test-token", apiVersion: 10 }).read(42, { mode: "content" })).rejects.toThrow(/redirect/i);
  });

  it.each([401, 403, 404, 406, 429, 500])("reports HTTP %i without retrying", async (status) => {
    let calls = 0; const baseUrl = await server((_request, response) => { calls++; response.writeHead(status); response.end("failure"); });
    await expect(new PaperlessSource({ baseUrl, apiVersion: 10 }).read(42, { mode: "content" })).rejects.toMatchObject({ status, code: "UNSUPPORTED_SOURCE" }); expect(calls).toBe(1);
  });

  it("rejects malformed payloads, unsupported versions and oversized bodies", async () => {
    const malformed = await server((_request, response) => json(response, { id: "wrong" }));
    await expect(new PaperlessSource({ baseUrl: malformed, apiVersion: 10 }).read(42, { mode: "content" })).rejects.toThrow(/document/i);
    const unsupported = await server((_request, response) => { response.setHeader("X-Version", "2.20.0"); json(response, doc()); });
    await expect(new PaperlessSource({ baseUrl: unsupported, apiVersion: 10 }).read(42, { mode: "content" })).rejects.toThrow(/3.x/);
    const oversized = await server((_request, response) => json(response, doc()));
    await expect(new PaperlessSource({ baseUrl: oversized, apiVersion: 10, maxResponseBytes: 30 }).read(42, { mode: "content" })).rejects.toThrow(/limit/i);
  });

  it("preserves cancellation and applies deadlines to response bodies", async () => {
    const baseUrl = await server((_request, response) => { response.setHeader("content-type", "application/json"); response.write('{"id":'); });
    const source = new PaperlessSource({ baseUrl, apiVersion: 10, timeoutMs: 30 });
    await expect(source.read(42, { mode: "content" })).rejects.toThrow(/deadline|timed out/i);
    const controller = new AbortController(); const reason = new Error("caller cancelled"); controller.abort(reason);
    await expect(source.read(42, { mode: "content", signal: controller.signal })).rejects.toBe(reason);
  });

  it("requires confirmed archive PDF and labels an explicit original fallback", async () => {
    let hasArchive = false; let mime = "application/pdf";
    const baseUrl = await server((request, response) => {
      if (request.url?.includes("metadata/")) return json(response, { ...metadata, original_filename: null, has_archive_version: hasArchive, archive_checksum: hasArchive ? "archive" : null });
      if (request.url?.includes("download/")) { response.setHeader("content-type", mime); return response.end(pdf); }
      return json(response, doc());
    });
    const source = new PaperlessSource({ baseUrl, apiVersion: 10 });
    await expect(source.read(42, { mode: "archive" })).rejects.toThrow(/archive/i);
    const fallback = await source.read(42, { mode: "archive", archiveFallback: "original" });
    expect(fallback.provenance.variant).toBe("original");
    expect(fallback.source.fileName).toBe("paperless-42-v43");
    hasArchive = true; mime = "text/plain";
    await expect(source.read(42, { mode: "archive" })).rejects.toThrow(/PDF/i);
  });

  it("loads only explicitly requested context with bounded native definitions", async () => {
    const calls: string[] = [];
    const baseUrl = await server((request, response) => {
      calls.push(request.url ?? "");
      if (request.url?.includes("custom_fields")) return json(response, { count: 1, next: null, results: [{ id: 7, name: "Category", data_type: "select", extra_data: { select_options: [{ id: "alpha", label: "Alpha" }] } }] });
      if (request.url?.includes("notes/")) return json(response, [{ id: 1, note: "existing audit" }]);
      response.writeHead(500); response.end();
    });
    const source = new PaperlessSource({ baseUrl, apiVersion: 10 });
    expect(await source.context(42, { include: [] })).toEqual([]);
    expect(calls).toEqual([]);
    expect(await source.context(42, { include: ["customFields", "notes"] })).toEqual([
      { kind: "customFields", values: [{ id: 7, name: "Category", type: "select", options: [{ id: "alpha", label: "Alpha" }] }] },
      { kind: "notes", values: [{ id: 1, note: "existing audit" }] },
    ]);
    expect(calls).toHaveLength(2);
  });
});
