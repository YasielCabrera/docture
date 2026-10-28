import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentConverter, DocumentLoaderData, Extractor, parseDoctureDocument, silentLogger, sourceLines, type FlexibleSchema } from "docture";
import { chunkDocument } from "docture/chunk";
import { scoreExtraction } from "docture/eval";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { llm } from "docture/llm/text";
import { makeInvoicePdf, makeRichDocumentPdf } from "docture/testing/fixtures";
import { PaperlessSource } from "../../src/sources/paperless/index.js";
import { mockModel } from "../llm/mock-model.js";

async function withArchive<T>(bytes: Uint8Array, run: (source: PaperlessSource) => Promise<T>): Promise<T> {
  const server = createServer((request, response) => {
    response.setHeader("X-Version", "3.3.4"); response.setHeader("X-Api-Version", "10");
    if (request.url?.includes("download/")) { response.setHeader("Content-Type", "application/pdf"); response.end(bytes); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url?.includes("metadata/")
      ? { has_archive_version: true, original_mime_type: "application/pdf", original_checksum: "original", archive_checksum: "archive", original_filename: "fixture.pdf", archive_media_filename: "fixture-archive.pdf" }
      : { id: 42, root_document: null, title: "Arbitrary source", content: "Exact stored OCR text from a full document. This fixture preserves the archive content without inventing positioned lines or physical page boundaries.", tags: [], custom_fields: [], correspondent: null, document_type: null, versions: [{ id: 42, is_root: true, checksum: "original", added: "2026-01-01" }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("missing address");
  try { return await run(new PaperlessSource({ baseUrl: `http://127.0.0.1:${address.port}/`, apiVersion: 10 })); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

async function verifySchema<T>(bytes: Uint8Array, schema: FlexibleSchema<T>, expected: T, field: string, value: string) {
  await withArchive(bytes, async (source) => {
    const content = await source.read(42, { mode: "content", versionId: 42 });
    const textModel = mockModel([expected]);
    const textExtractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model: textModel.model, citations: true })] });
    const textResult = await textExtractor.extract(content.source, schema);
    expect(textResult.features.hasGeometry).toBe(false);
    expect(textResult.citations).toEqual([{ path: field, status: "uncited", ids: [] }]);
    await textExtractor.dispose();

    const archive = await source.read(42, { mode: "archive", versionId: 42 });
    expect("bytes" in archive.source && archive.source.bytes).toEqual(bytes);
    const loader = new DocumentLoaderPdfJs();
    if (!("bytes" in archive.source)) throw new Error("archive must be bytes");
    const loaded = await loader.load(archive.source, { signal: new AbortController().signal, logger: silentLogger });
    const line = loaded.pages.flatMap(sourceLines).find((line) => line.text.includes(value));
    expect(line).toBeDefined(); if (line === undefined) throw new Error("fixture line missing");
    const provider = mockModel([
      { data: { [field]: "BAD" }, citations: [{ path: field, ids: [line.id] }] },
      { data: expected, citations: [{ path: field, ids: [line.id] }] },
    ]);
    const extractor = new Extractor({ loaders: [loader], strategies: [llm({ model: provider.model, citations: true, completion: "forbidden" })] });
    const result = await extractor.extract(archive.source, schema, {
      onRuleFailure: "fail", maxRepairs: 1,
      rules: [(data) => JSON.stringify(data) === JSON.stringify(expected) ? [] : [{ path: field, message: "Fixture value must be preserved." }]],
    });
    expect(result.data).toEqual(expected);
    expect(result.validation).toEqual({ valid: true, issues: [] });
    expect(result.attempts.filter((attempt) => attempt.stage === "extract" || attempt.stage === "repair").map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(result.citations).toEqual([{ path: field, status: "verified", ids: [line.id] }]);
    expect(provider.calls).toHaveLength(2);
    expect(scoreExtraction(expected, result.data).exactMatch).toBe(true);
    const converter = new DocumentConverter({ loaders: [new DocumentLoaderPdfJs()] });
    const converted = await converter.convert(archive.source, { format: "json", assets: "omit" });
    const parsed = parseDoctureDocument(JSON.parse(converted.content));
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error("invalid saved fixture");
    const chunks = chunkDocument(parsed.document, { budget: { unit: "characters", max: 500 } });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.text.includes(value))).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.provenance).every((segment) => segment.pageNumber >= 1 && segment.sourceIds.length > 0)).toBe(true);
    await converter.dispose(); await extractor.dispose();
  });
}

describe("Paperless schema workflows", () => {
  it("reuses exact archived invoice bytes for field verification, rule repair, saved conversion, chunking and eval", async () => {
    const fixture = await makeInvoicePdf({ seed: 21, lineItemCount: 2 });
    await verifySchema(fixture.bytes, z.object({ invoiceNumber: z.string() }), { invoiceNumber: fixture.expected.invoiceNumber }, "invoiceNumber", fixture.expected.invoiceNumber);
  });
  it("supports an unrelated report schema through the same configured extraction pipeline", async () => {
    const fixture = await makeRichDocumentPdf();
    await verifySchema(fixture.bytes, z.object({ title: z.string() }), { title: fixture.expected.title }, "title", fixture.expected.title);
  });
  it("preserves conflicting page values rather than hiding them in a source adapter", async () => {
    const fixture = await makeRichDocumentPdf();
    await withArchive(fixture.bytes, async (source) => {
      const archived = await source.read(42, { mode: "archive", versionId: 42 });
      const provider = mockModel([{ title: "Report first" }, { title: "Report second" }]);
      const extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [llm({ model: provider.model, completion: "paginate" })] });
      const result = await extractor.extract(archived.source, z.object({ title: z.string() }));
      expect(result.conflicts).toEqual([{ path: "title", values: [{ value: "Report first", pages: [1] }, { value: "Report second", pages: [2] }] }]);
      await extractor.dispose();
    });
  });
});
