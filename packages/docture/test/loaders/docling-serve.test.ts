import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DocumentConverter, Extractor, parseDoctureDocument } from "docture";
import { llm } from "docture/llm/text";
import { z } from "zod";
import { DoclingServeClient, DoclingServeError, DocumentLoaderDoclingServe } from "../../src/loaders/docling/index.js";
import { nativeDocument } from "../import/docling-fixtures.js";
import { mockModel } from "../llm/mock-model.js";

const calls: { path: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
let polls = 0;
let baseUrl = "";
let status = "success";
const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  calls.push({ path: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks) });
  response.setHeader("content-type", "application/json");
  if (request.url?.endsWith("/async")) response.end(JSON.stringify({ task_id: "job-1", task_status: "pending" }));
  else if (request.url?.includes("/status/poll/")) response.end(JSON.stringify({ task_id: "job-1", task_status: ++polls === 1 ? "started" : "success" }));
  else {
    const epub = Buffer.concat(chunks).includes(Buffer.from("application/epub+zip"));
    const native = nativeDocument(epub ? "letter" : "report");
    native.origin.mimetype = epub ? "application/epub+zip" : input.mimeType;
    native.origin.filename = epub ? "appointment.epub" : "report.docx";
    if (epub) { native.pages = {}; for (const item of native.texts) item.prov = []; for (const item of native.tables) item.prov = []; }
    response.end(JSON.stringify({ status, document: { json_content: native }, errors: [] }));
  }
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address");
  baseUrl = `http://127.0.0.1:${address.port}/prefix/`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))));
const input = { bytes: new Uint8Array([80, 75, 1, 2]), fileName: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

it("posts exact multipart bytes, filename, MIME, JSON target and typed options beneath the configured prefix", async () => {
  const client = new DoclingServeClient({ baseUrl, apiKey: "fixture-key", headers: { "x-client": "fixture" } });
  const result = await client.convert(input, { doOcr: false, tableMode: "accurate", pageRange: [1, 5] });
  const call = calls.at(-1);
  expect(call?.path).toBe("/prefix/v1/convert/file");
  expect(call?.headers["x-api-key"]).toBe("fixture-key");
  expect(call?.headers["x-client"]).toBe("fixture");
  expect(call?.body.includes(Buffer.from(input.bytes))).toBe(true);
  expect(call?.body.toString()).toContain('name="files"; filename="report.docx"');
  expect(call?.body.toString()).toContain(`Content-Type: ${input.mimeType}`);
  expect(call?.body.toString()).toMatch(/name="to_formats"\r\n\r\njson/);
  expect(call?.body.toString()).toMatch(/name="target_type"\r\n\r\ninbody/);
  expect(call?.body.toString()).toMatch(/name="do_ocr"\r\n\r\nfalse/);
  expect(result.document.pages[0]?.elements[2]?.kind).toBe("table");
});

it("keeps task state separate from conversion status and resumes a serializable job without resubmission", async () => {
  polls = 0;
  const client = new DoclingServeClient({ baseUrl, pollIntervalMs: 0, maxPolls: 4 });
  const before = calls.length;
  const job = await client.submit(input);
  expect(job.reference.taskId).toBe("job-1");
  const resumed = client.resume(JSON.parse(JSON.stringify(job.reference)));
  const result = await resumed.wait();
  expect(result.taskId).toBe("job-1");
  expect(calls.slice(before).filter((call) => call.path.endsWith("/async"))).toHaveLength(1);
  expect(polls).toBe(2);
});

it.each(["partial_success", "skipped", "failure"])("fails closed on conversion status %s", async (conversionStatus) => {
  status = conversionStatus;
  try {
    const client = new DoclingServeClient({ baseUrl });
    await expect(client.convert(input)).rejects.toMatchObject({ reason: "conversion" });
    if (conversionStatus === "partial_success") {
      const partial = await client.convert(input, { allowPartial: true });
      expect(partial.diagnostics.some((entry) => entry.code === "PARTIAL_CONVERSION")).toBe(true);
    }
  } finally { status = "success"; }
});

it("preserves allowed partial status and service diagnostics in saved extraction and conversion artifacts", async () => {
  const errors = [{ component_type: "docling", module_name: "conversion", error_message: "last page failed" }];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: "partial_success", document: { json_content: nativeDocument() }, errors }));
  const client = new DoclingServeClient({ baseUrl, fetch: fetcher });
  const partial = await client.resume({ service: baseUrl, taskId: "partial-job" }, { allowPartial: true }).result();
  expect(partial.source.loaded.sourceMetadata).toMatchObject({
    conversionStatus: "partial_success", doclingErrors: errors,
    doclingTask: { taskId: "partial-job", service: baseUrl },
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "PARTIAL_CONVERSION" })]),
  });
  expect(partial.document.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LAYOUT_DEGRADED", message: expect.stringContaining("PARTIAL_CONVERSION") })]));
  const savedDocument = JSON.parse(JSON.stringify(partial.document));
  expect(parseDoctureDocument(savedDocument).ok).toBe(true);
  const canonicalDocument = JSON.stringify(savedDocument, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
  expect(partial.provenance.documentDigest).toBe(`sha256:${createHash("sha256").update(canonicalDocument).digest("hex")}`);
  expect(partial.source.loaded.sourceMetadata?.doclingProvenance).toEqual(partial.provenance);
  const loader = new DocumentLoaderDoclingServe({ baseUrl, fetch: fetcher, conversion: { allowPartial: true } });
  const extracted = await new Extractor({ loaders: [loader], strategies: [{ name: "literal", async extract() { return { data: { reading: 100 } }; } }] }).extract(input, z.object({ reading: z.number() }));
  const savedExtraction = JSON.parse(JSON.stringify(extracted));
  expect(savedExtraction.data).toEqual({ reading: 100 });
  expect(savedExtraction.sourceMetadata).toMatchObject({
    conversionStatus: "partial_success", doclingErrors: errors,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "PARTIAL_CONVERSION" })]),
  });
  const converted = await new DocumentConverter({ loaders: [loader] }).convert(input, { format: "json" });
  expect(JSON.parse(converted.content).warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "LAYOUT_DEGRADED", message: expect.stringContaining("PARTIAL_CONVERSION") })]));
  expect(JSON.parse(converted.content).warnings).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("last page failed") })]));
});

it("keeps complete service errors in source metadata when the normalized warning excerpt is bounded", async () => {
  const errors = [{ error_message: `last page failed: ${"detail ".repeat(1000)}` }];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: "partial_success", document: { json_content: nativeDocument() }, errors }));
  const result = await new DoclingServeClient({ baseUrl, fetch: fetcher }).convert(input, { allowPartial: true });
  expect(result.source.loaded.sourceMetadata?.doclingErrors).toEqual(errors);
  const warning = result.document.warnings.find((entry) => entry.message.startsWith("PARTIAL_CONVERSION:"));
  expect(warning?.message).toContain("last page failed");
  expect(warning?.message).toContain("[truncated; complete diagnostics in sourceMetadata.doclingErrors]");
  expect(warning?.message.length).toBeLessThan(4300);
});

it("does not forward service credentials to a redirected foreign origin or retry ambiguous POSTs", async () => {
  const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://foreign.test/steal" } }));
  await expect(new DoclingServeClient({ baseUrl, apiKey: "private", fetch: redirectFetch }).convert(input)).rejects.toMatchObject({ reason: "redirect" });
  expect(redirectFetch).toHaveBeenCalledTimes(1);
  const failingFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection reset"));
  await expect(new DoclingServeClient({ baseUrl, fetch: failingFetch }).submit(input)).rejects.toMatchObject({ reason: "transport", outcome: "unknown" });
  expect(failingFetch).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 429, 500, 504])("reports HTTP %s without resubmitting", async (httpStatus) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: httpStatus }));
  await expect(new DoclingServeClient({ baseUrl, fetch: fetcher }).convert(input)).rejects.toMatchObject({ reason: "http", status: httpStatus, outcome: httpStatus >= 500 ? "unknown" : "failed" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("bounds GET retries, polling, response bytes and validates options before sending", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 500 }));
  const client = new DoclingServeClient({ baseUrl, fetch: fetcher, getRetries: 2, pollIntervalMs: 0, maxPolls: 1 });
  await expect(client.resume({ taskId: "job-1", service: baseUrl }).wait()).rejects.toBeInstanceOf(DoclingServeError);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const oversized = vi.fn<typeof fetch>().mockImplementation(async () => new Response('"' + "x".repeat(100) + '"'));
  await expect(new DoclingServeClient({ baseUrl, fetch: oversized, maxResponseBytes: 20 }).convert(input)).rejects.toMatchObject({ reason: "limit" });
  const unused = vi.fn<typeof fetch>();
  await expect(new DoclingServeClient({ baseUrl, fetch: unused }).convert(input, { pageRange: [4, 1] })).rejects.toMatchObject({ reason: "configuration" });
  expect(unused).not.toHaveBeenCalled();
});

it("loads DOCX and EPUB through ordinary schema extraction with native evidence and conversion", async () => {
  const loader = new DocumentLoaderDoclingServe({ baseUrl });
  expect(loader.capabilities.geometry).toBe(false);
  for (const mimeType of [input.mimeType, "application/epub+zip"]) {
    const raw = { ...input, mimeType };
    const expected = mimeType === "application/epub+zip" ? 42 : 100;
    const imported = await new DoclingServeClient({ baseUrl }).convert(raw);
    const source = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []).find((entry) => entry.text === String(expected));
    const { model } = mockModel([{ data: { reading: expected }, citations: [{ path: "reading", ids: [source?.id] }] }]);
    const result = await new Extractor({ loaders: [loader], strategies: [llm({ model, citations: true })] }).extract(raw, z.object({ reading: z.number() }));
    expect(result.data).toEqual({ reading: expected });
    expect(result.citations?.[0]?.status).toBe("verified");
    expect(result.evidenceSources?.[0]?.granularity).toBe("table-cell");
    const converted = await new DocumentConverter({ loaders: [loader] }).convert(raw, { format: "json" });
    expect(JSON.parse(converted.content).pages[0].elements[2].kind).toBe("table");
  }
});

it("distinguishes expired results, failed tasks, malformed conversion and ambiguous submission", async () => {
  const expired = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 410 }));
  const reference = { taskId: "job-1", service: baseUrl };
  await expect(new DoclingServeClient({ baseUrl, fetch: expired }).resume(reference).result()).rejects.toMatchObject({ reason: "expired", taskId: "job-1" });
  const failed = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ task_id: "job-1", task_status: "failure" }));
  const job = await new DoclingServeClient({ baseUrl, fetch: failed }).submit(input);
  await expect(job.wait()).rejects.toMatchObject({ reason: "task", taskId: "job-1" });
  expect(failed).toHaveBeenCalledTimes(1);
  const malformed = vi.fn<typeof fetch>().mockImplementation(async () => new Response("not-json"));
  await expect(new DoclingServeClient({ baseUrl, fetch: malformed }).convert(input)).rejects.toMatchObject({ reason: "response", outcome: "unknown" });
  const unusable = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ task_status: "success" }));
  await expect(new DoclingServeClient({ baseUrl, fetch: unusable }).submit(input)).rejects.toMatchObject({ reason: "response", outcome: "unknown" });
  expect(unusable).toHaveBeenCalledTimes(1);
});

it("honors request and job deadlines while preserving the caller's abort reason", async () => {
  const stalled = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined || signal === null) throw new Error("missing signal");
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await expect(new DoclingServeClient({ baseUrl, fetch: stalled, requestTimeoutMs: 10 }).submit(input)).rejects.toMatchObject({ reason: "timeout", outcome: "unknown" });
  const controller = new AbortController();
  const reason = new DOMException("caller stopped", "AbortError");
  const pending = new DoclingServeClient({ baseUrl, fetch: stalled }).convert(input, { signal: controller.signal });
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  const waiting = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ task_id: "job-1", task_status: "started" }));
  await expect(new DoclingServeClient({ baseUrl, fetch: waiting, jobTimeoutMs: 10, pollIntervalMs: 1000 }).resume({ taskId: "job-1", service: baseUrl }).wait()).rejects.toMatchObject({ reason: "timeout", taskId: "job-1", outcome: "unknown" });
});
