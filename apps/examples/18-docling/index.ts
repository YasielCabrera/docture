import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { DocumentLoaderData, parseDoctureDocument } from "docture";
import { Extractor } from "docture/node";
import { chunkDocument } from "docture/chunk";
import { importDoclingDocument } from "docture/import/docling";
import { DoclingServeClient, DocumentLoaderDoclingServe } from "docture/loaders/docling";
import { llm } from "docture/llm/text";

function fixedModel(answer: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "offline-docling-example", modelId: "deterministic",
    async doGenerate() {
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

export async function runDoclingExample() {
  const report: unknown = JSON.parse(await readFile(new URL("./report.json", import.meta.url), "utf8"));
  const letter: unknown = JSON.parse(await readFile(new URL("./letter.json", import.meta.url), "utf8"));
  const jobs = new Map<string, unknown>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    response.setHeader("content-type", "application/json");
    if (request.url === "/export/report") { response.end(JSON.stringify(report)); return; }
    if (request.url?.endsWith("/async")) {
      const taskId = `job-${jobs.size + 1}`;
      jobs.set(taskId, body.includes(Buffer.from("application/epub+zip")) ? letter : report);
      response.end(JSON.stringify({ task_id: taskId, task_status: "pending" })); return;
    }
    const taskId = request.url?.split("/").at(-1) ?? "";
    if (request.url?.includes("/status/poll/")) { response.end(JSON.stringify({ task_id: taskId, task_status: "success" })); return; }
    const native = request.url?.includes("/result/") ? jobs.get(taskId) : report;
    response.end(JSON.stringify({ status: "success", document: { json_content: native }, errors: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing mock server address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const imported = importDoclingDocument(await (await fetch(`${base}/export/report`)).json());
    const saved = parseDoctureDocument(imported.document);
    assert.ok(saved.ok);
    const chunks = chunkDocument(saved.document, { budget: { unit: "characters", max: 200 } });
    const pressure = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []).find((entry) => entry.text === "100");
    assert.ok(pressure);
    const pressureAnswer = { data: { pressure: 100 }, citations: [{ path: "pressure", ids: [pressure.id] }] };
    const importedResult = await new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model: fixedModel(pressureAnswer), citations: true })] }).extract(imported.source, z.object({ pressure: z.number() }));

    const client = new DoclingServeClient({ baseUrl: `${base}/docling/`, pollIntervalMs: 0 });
    const office = { bytes: new Uint8Array([80, 75, 1, 2]), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "report.docx" };
    const converted = await client.convert(office, { doOcr: false, tableMode: "accurate" });
    const loader = new DocumentLoaderDoclingServe({ baseUrl: `${base}/docling/` });
    const officeResult = await new Extractor({ loaders: [loader], strategies: [llm({ model: fixedModel(pressureAnswer), citations: true })] }).extract(office, z.object({ pressure: z.number() }));
    const job = await client.submit({ bytes: new Uint8Array([80, 75, 3, 4]), mimeType: "application/epub+zip", fileName: "appointment.epub" });
    const epub = await client.resume(JSON.parse(JSON.stringify(job.reference))).wait();
    const room = epub.source.loaded.pages.flatMap((page) => page.evidence ?? []).find((entry) => entry.text === "42");
    assert.ok(room);
    const epubResult = await new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model: fixedModel({ data: { room: 42 }, citations: [{ path: "room", ids: [room.id] }] }), citations: true })] }).extract(epub.source, z.object({ room: z.number() }));
    assert.deepEqual(importedResult.data, { pressure: 100 });
    assert.deepEqual(officeResult.data, { pressure: 100 });
    assert.deepEqual(epubResult.data, { room: 42 });
    assert.equal(converted.document.sourceDigest, imported.document.sourceDigest);
    const directory = await mkdtemp(join(tmpdir(), "docture-docling-example-"));
    await writeFile(join(directory, "document.json"), JSON.stringify(imported.document, null, 2));
    await writeFile(join(directory, "provenance.json"), JSON.stringify(imported.provenance, null, 2));
    const output = { imported: importedResult.data, office: officeResult.data, epub: epubResult.data, validation: officeResult.validation, citations: officeResult.citations, limitations: imported.diagnostics, sourceDigest: imported.provenance.sourceDigest, job: job.reference, chunks: chunks.length, directory };
    console.log(JSON.stringify(output, null, 2));
    return output;
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDoclingExample().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
