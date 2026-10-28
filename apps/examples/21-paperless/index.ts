import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { DocumentLoaderData, silentLogger, sourceLines } from "docture";
import { DocumentConverter, Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { llm } from "docture/llm/text";
import { PaperlessSource } from "docture/sources/paperless";
import { PaperlessSink } from "docture/sinks/paperless";
import { createExampleQueue, createPaperlessIngress, enqueuePostConsume, runPaperlessJob } from "./triggers.js";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { isMain, run } from "../shared/run.js";

function provider(reply: unknown) {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify(reply) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }, warnings: [],
  }) });
}

export async function main(): Promise<void> {
  const fixture = await makeInvoicePdf({ seed: 21, lineItemCount: 2 });
  const content = `Invoice ${fixture.expected.invoiceNumber}. Seller ${fixture.expected.sellerName}. Total ${fixture.expected.total}. This is the full stored OCR text used by the caller's schema.`;
  const fields = new Map<number, string>();
  const tags = new Set([1]);
  const notes: { id: number; note: string }[] = [];
  let failNextNote = true;
  const document = { user_can_change: true, id: 42, root_document: null, title: "Example invoice", content, tags: [1], custom_fields: [], correspondent: null, document_type: null, versions: [{ id: 42, is_root: true, checksum: "fixture-original", added: "2026-01-01" }] };
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader("X-Version", "3.3.4"); response.setHeader("X-Api-Version", "10");
    if (request.headers.authorization !== "Token example-token") { response.writeHead(401); response.end(); return; }
    const url = new URL(request.url ?? "", "http://local");
    if (request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.ok(typeof body === "object" && body !== null);
      response.setHeader("content-type", "application/json");
      if (url.pathname.endsWith("notes/")) {
        if (failNextNote) { failNextNote = false; response.destroy(); return; }
        assert.ok("note" in body && typeof body.note === "string"); notes.push({ id: notes.length + 1, note: body.note }); response.end(JSON.stringify(notes)); return;
      }
      assert.ok("method" in body && "parameters" in body && typeof body.parameters === "object" && body.parameters !== null);
      if (body.method === "modify_custom_fields") {
        assert.ok("add_custom_fields" in body.parameters && typeof body.parameters.add_custom_fields === "object" && body.parameters.add_custom_fields !== null);
        assert.ok("remove_custom_fields" in body.parameters); assert.deepEqual(body.parameters.remove_custom_fields, []);
        for (const [id, value] of Object.entries(body.parameters.add_custom_fields)) { assert.equal(typeof value, "string"); fields.set(Number(id), String(value)); }
      } else { assert.equal(body.method, "add_tag"); assert.ok("tag" in body.parameters && typeof body.parameters.tag === "number"); tags.add(body.parameters.tag); }
      response.end('{"result":"OK"}'); return;
    }
    if (url.pathname.endsWith("custom_fields/")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ count: 2, next: null, results: [{ id: 1, name: "Invoice", data_type: "string", extra_data: {} }, { id: 2, name: "Seller", data_type: "string", extra_data: {} }] })); return; }
    if (url.pathname.endsWith("tags/")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ count: 2, next: null, results: [{ id: 1, name: "Existing" }, { id: 3, name: "Extracted" }] })); return; }
    if (url.pathname.endsWith("notes/")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(notes)); return; }

    if (request.url?.includes("download/")) { response.setHeader("content-type", "application/pdf"); response.end(fixture.bytes); return; }
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("metadata/")) { response.end(JSON.stringify({ has_archive_version: true, original_mime_type: "application/pdf", original_checksum: "fixture-original", archive_checksum: "fixture-archive", original_filename: "invoice.pdf", archive_media_filename: "invoice-archive.pdf" })); return; }
    if (new URL(request.url ?? "", "http://local").pathname === "/api/documents/") { response.end(JSON.stringify({ count: 1, next: null, results: [{ id: 42, content: "query snippet is not the extraction source" }] })); return; }
    response.end(JSON.stringify({ ...document, tags: [...tags], custom_fields: [...fields].map(([field, value]) => ({ field, value })) }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("Server did not bind.");
  const paperless = new PaperlessSource({ baseUrl: `http://127.0.0.1:${address.port}/`, apiVersion: 10, token: "example-token" });
  try {
    const schema = z.object({ invoiceNumber: z.string(), sellerName: z.string() });
    const expected = { invoiceNumber: fixture.expected.invoiceNumber, sellerName: fixture.expected.sellerName };
    const text = await paperless.read(42, { mode: "content", versionId: 42 });
    const textExtractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model: provider(expected), citations: true })] });
    const textResult = await textExtractor.extract(text.source, schema);
    assert.deepEqual(textResult.data, expected);
    assert.equal(textResult.citations?.[0]?.status, "uncited");
    await textExtractor.dispose();
    let matches = 0;
    for await (const match of paperless.query({ query: fixture.expected.invoiceNumber, limit: 1, mode: "content" })) {
      assert.equal("loaded" in match.source && match.source.loaded.text, content); matches++;
    }
    assert.equal(matches, 1);

    const archive = await paperless.read(42, { mode: "archive", versionId: 42 });
    assert.ok("bytes" in archive.source);
    const loader = new DocumentLoaderPdfJs();
    const loaded = await loader.load(archive.source, { signal: new AbortController().signal, logger: silentLogger });
    const line = loaded.pages.flatMap(sourceLines).find((line) => line.text.includes(fixture.expected.invoiceNumber));
    assert.ok(line);
    const seller = loaded.pages.flatMap(sourceLines).find((line) => line.text.includes(fixture.expected.sellerName));
    assert.ok(seller);
    const extractor = new Extractor({ loaders: [loader], strategies: [llm({ model: provider({ data: expected, citations: [{ path: "invoiceNumber", ids: [line.id] }, { path: "sellerName", ids: [seller.id] }] }), citations: true, completion: "forbidden" })] });
    const result = await extractor.extract(archive.source, schema);
    assert.deepEqual(result.data, expected);
    assert.equal(result.citations?.[0]?.status, "verified");
    const converter = new DocumentConverter({ loaders: [new DocumentLoaderPdfJs()] });
    const converted = await converter.convert(archive.source, { format: "json", assets: "omit" });
    const output = await mkdtemp(join(tmpdir(), "docture-paperless-example-"));
    await writeFile(join(output, "source.pdf"), archive.source.bytes);
    await writeFile(join(output, "content-extraction.json"), JSON.stringify({ file: "paperless:42", ok: true, ...textResult, source: text.provenance, sourceText: content, limitations: text.limitations }, null, 2));
    await writeFile(join(output, "provenance.json"), JSON.stringify(archive.provenance, null, 2));
    await writeFile(join(output, "extraction.json"), JSON.stringify({ ok: true, ...result, source: archive.provenance }, null, 2));
    await writeFile(join(output, "conversion.json"), converted.content);
    assert.ok(requests.every((request) => request.startsWith("GET ")));
    const sink = new PaperlessSink({ baseUrl: `http://127.0.0.1:${address.port}/`, apiVersion: 10, token: "example-token", fields: [{ path: ["invoiceNumber"], fieldId: 1 }, { path: ["sellerName"], fieldId: 2 }], tagIds: [3], auditNote: "Docture example extraction" });
    const plan = await sink.plan({ provenance: archive.provenance, extraction: result, schemaId: "example-invoice-v1", mappingId: "example-fields-v1", extractionId: "example-run" });
    assert.deepEqual(plan.blocked, []);
    await writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2));
    fields.set(1, "human value");
    const partial = await sink.apply(plan);
    assert.equal(partial.status, "partial");
    assert.equal(partial.outcomes[0]?.status, "skipped");
    const repeated = await sink.apply(plan);
    assert.equal(repeated.status, "complete");
    assert.equal(fields.get(1), "human value"); assert.equal(fields.get(2), expected.sellerName);
    assert.deepEqual([...tags], [1, 3]); assert.equal(notes.length, 1);
    const again = await sink.apply(plan); assert.ok(again.outcomes.every((outcome) => outcome.status === "skipped")); assert.equal(notes.length, 1);
    await writeFile(join(output, "apply-partial.json"), JSON.stringify(partial, null, 2));
    await writeFile(join(output, "apply-retry.json"), JSON.stringify(repeated, null, 2));
    const queue = createExampleQueue();
    const instance = `http://127.0.0.1:${address.port}/`;
    const handleIngress = createPaperlessIngress({ instance, token: "ingress-example-token", queue });
    const ingress = createServer((request, response) => { void handleIngress(request, response); });
    ingress.listen(0, "127.0.0.1"); await once(ingress, "listening");
    const ingressAddress = ingress.address(); assert.ok(ingressAddress !== null && typeof ingressAddress !== "string");
    try {
      const env = { DOCUMENT_ID: "42", PAPERLESS_INSTANCE: instance, PAPERLESS_INGRESS_URL: `http://127.0.0.1:${ingressAddress.port}/`, PAPERLESS_INGRESS_TOKEN: "ingress-example-token" };
      await enqueuePostConsume(env); await enqueuePostConsume(env);
      const updated = await fetch(env.PAPERLESS_INGRESS_URL, { method: "POST", headers: { Authorization: "Bearer ingress-example-token" }, body: JSON.stringify({ event: "document_updated", instance, documentId: 42 }) });
      assert.equal(updated.status, 202);
      const updateResult: unknown = await updated.json();
      assert.ok(typeof updateResult === "object" && updateResult !== null && "ignored" in updateResult);
      assert.equal(updateResult.ignored, true);
      const job = queue.take(); assert.ok(job); assert.equal(queue.take(), undefined);
      await runPaperlessJob(job, { instance, source: paperless, read: { mode: "content" }, process: async (fresh) => { assert.equal(fresh.provenance.documentId, 42); } });
    } finally { ingress.closeAllConnections(); await new Promise<void>((resolve) => ingress.close(() => resolve())); }

    await converter.dispose(); await extractor.dispose();
    console.log(`Paperless sources, schemas, partial retry, co-writer preservation, one audit note and authenticated queue triggers passed. ${output}`);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

if (isMain(import.meta.url)) await run(main);
