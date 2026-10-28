import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createExampleQueue, createPaperlessIngress, enqueuePostConsume, runPaperlessJob } from "../21-paperless/triggers.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });

it("authenticates ingress, deduplicates added events and ignores document-update loops", async () => {
  const queue = createExampleQueue(); const instance = "https://paperless.example.test/prefix/";
  const handler = createPaperlessIngress({ queue, instance, token: "fixture-token" });
  const server = createServer((request, response) => { void handler(request, response); }); servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("no address"); const ingress = `http://127.0.0.1:${address.port}/`;
  const post = (body: unknown, token = "fixture-token") => fetch(ingress, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  expect((await post({ event: "document_added", documentId: 42, instance }, "wrong")).status).toBe(401);
  expect((await post({ event: "document_added", documentId: 0, instance })).status).toBe(400);
  expect((await post({ event: "document_added", documentId: 42, instance: "https://foreign.test/" })).status).toBe(400);
  expect(await (await post({ event: "document_added", documentId: 42, instance })).json()).toEqual({ result: "queued" });
  expect(await (await post({ event: "document_added", documentId: 42, instance })).json()).toEqual({ result: "duplicate" });
  expect(await (await post({ event: "document_updated", documentId: 42, instance })).json()).toMatchObject({ ignored: true });
  const job = queue.take(); expect(job?.documentId).toBe(42); expect(queue.take()).toBeUndefined(); if (job === undefined) throw new Error("missing job");
  let reads = 0;
  const result = await runPaperlessJob(job, { instance, source: { async read() { reads++; return { source: { bytes: new Uint8Array([1]) }, provenance: { kind: "paperless", schemaVersion: 1, instance, documentId: 42, fileVersionId: 42, variant: "original", digest: "a".repeat(64), apiVersion: 10, serverVersion: "3.3.4", nativeChecksum: "native", metadata: { id: 42, rootDocumentId: null, title: "Source", tags: [], customFields: [], correspondent: null, documentType: null, versions: [] }, uiUrl: `${instance}documents/42/details` }, limitations: [] }; } }, read: { mode: "original" }, process: async (source) => source.provenance.documentId });
  expect(result).toBe(42); expect(reads).toBe(1);
});

it("post-consume submits only a validated ID and returns after queue acceptance", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"result":"queued"}', { status: 202 }); };
  const env = { DOCUMENT_ID: "42", PAPERLESS_INSTANCE: "https://paperless.example.test/", PAPERLESS_INGRESS_URL: "https://queue.example.test/added", PAPERLESS_INGRESS_TOKEN: "fixture-token" };
  await enqueuePostConsume(env, fetcher);
  expect(calls).toHaveLength(1); expect(JSON.parse(String(calls[0]?.options?.body))).toEqual({ event: "document_added", instance: env.PAPERLESS_INSTANCE, documentId: 42 });
  await expect(enqueuePostConsume({ ...env, DOCUMENT_ID: "42;rm -rf" }, fetcher)).rejects.toThrow(/DOCUMENT_ID/); expect(calls).toHaveLength(1);
});
