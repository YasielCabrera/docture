import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterAll, expect, it } from "vitest";
import { z } from "zod";
import { DocumentLoaderData, Extractor } from "docture";
import { importDoclingDocument } from "docture/import/docling";
import { llm } from "docture/llm/text";
import { mockModel } from "../../docture/test/llm/mock-model.js";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAICAYAAADaxo44AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAWSURBVAiZY/z///9/BiyACZvg4JUAABofBAymvql2AAAAAElFTkSuQmCC";
const original = new TextEncoder().encode("original research report bytes");
const subject = "Research report with a complete native text evidence record";
const raw = {
  schema_name: "DoclingDocument", version: "1.10.0", name: "research",
  body: { self_ref: "#/body", children: [{ $ref: "#/texts/0" }, { $ref: "#/tables/0" }] },
  pages: { "1": { page_no: 1, size: { width: 600, height: 800 } } },
  texts: [{ self_ref: "#/texts/0", label: "text", text: subject, prov: [{ page_no: 1, bbox: { l: 10, t: 20, r: 300, b: 40, coord_origin: "TOPLEFT" }, charspan: [0, subject.length] }] }],
  tables: [{ self_ref: "#/tables/0", label: "table", prov: [{ page_no: 1, bbox: { l: 10, t: 100, r: 300, b: 120, coord_origin: "TOPLEFT" }, charspan: [0, 0] }], data: { num_rows: 1, num_cols: 1, table_cells: [{ text: "100", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, bbox: { l: 10, t: 100, r: 300, b: 120, coord_origin: "TOPLEFT" } }] } }],
};

async function extraction(bound = false) {
  const imported = importDoclingDocument(raw, bound ? { coordinateSpace: { unit: "points" }, physicalSource: { bytes: original, attestExportMatchesSource: true } } : {});
  const sources = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []);
  const subjectSource = sources.find((source) => source.text === subject); const reading = sources.find((source) => source.text === "100");
  const data = { subject, reading: 100 };
  const cited = [{ path: "subject", ids: [subjectSource?.id] }, { path: "reading", ids: [reading?.id] }];
  const { model } = mockModel([{ data, citations: cited }]);
  const result = await new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model, citations: true })] }).extract(imported.source, z.object({ subject: z.string(), reading: z.number() }));
  const outcome = { data, citations: [{ path: ["subject"], status: "verified", ids: [subjectSource?.id], value: data.subject }, { path: ["reading"], status: "verified", ids: [reading?.id], value: data.reading }] };
  return { imported, result, outcome };
}

it("preserves library native citations in CLI extraction and reviews saved elements/cells without images", async () => {
  const { imported, result, outcome } = await extraction();
  const cwd = await tempDir("native-evidence");
  await writeFixture(cwd, "original.pdf", new TextDecoder().decode(original));
  await writeFixture(cwd, "schema.json", JSON.stringify({ type: "object", properties: { subject: { type: "string" }, reading: { type: "number" } }, required: ["subject", "reading"], additionalProperties: false }));
  await writeFixture(cwd, "docture.config.mjs", `const loaded=${JSON.stringify(imported.source.loaded)}; export default {loaders:[{name:"native-fixture",capabilities:{text:true,geometry:false,images:false,mimeTypes:["application/pdf"],facts:["NATIVE_EVIDENCE"]},async load(){return loaded;}}],strategies:[{name:"native-schema",async extract(){return ${JSON.stringify(outcome)};}}]};`);
  const extracted = await cli(["extract", "original.pdf", "--schema", "schema.json", "--full", "--citations"], { cwd });
  expect(extracted.code, extracted.stderr).toBe(0);
  const saved = JSON.parse(extracted.stdout);
  expect(saved.results[0].evidenceSources.map((source: { granularity: string }) => source.granularity)).toEqual(["element", "table-cell"]);
  await writeFixture(cwd, "saved.json", JSON.stringify(saved));
  const review = await cli(["review", "--extraction", "saved.json", "--source", "original.pdf", "--no-config", "--out", "review.html"], { cwd });
  expect(review.code, review.stderr).toBe(0);
  const html = await readFile(join(cwd, "review.html"), "utf8");
  expect(html).toContain('data-granularity="table-cell"');
  expect(html).toContain("Page images and physical highlights are unavailable");
  expect(html).toContain("Research report");
  expect(html).not.toContain('<div class="line"');
  const live = await cli(["review", "original.pdf", "--schema", "schema.json", "--out", "live.html"], { cwd });
  expect(live.code, live.stderr).toBe(0);
  expect(await readFile(join(cwd, "live.html"), "utf8")).toContain('data-granularity="table-cell"');
  await writeFixture(cwd, "conversion.json", JSON.stringify(imported.document));
  const conversion = await cli(["review", "--conversion", "conversion.json", "--source", "original.pdf", "--no-config", "--out", "conversion.html"], { cwd });
  expect(conversion.code, conversion.stderr).toBe(0);
  expect(await readFile(join(cwd, "conversion.html"), "utf8")).toContain("Research report");
  expect(result.citations?.every((citation) => citation.status === "verified")).toBe(true);
});

it("permits physical element/cell overlays only for matching bound source bytes", async () => {
  const { imported, result } = await extraction(true);
  const cwd = await tempDir("native-evidence-binding");
  await writeFixture(cwd, "original.pdf", new TextDecoder().decode(original));
  await writeFixture(cwd, "other.pdf", "different original bytes");
  await writeFixture(cwd, "saved.json", JSON.stringify({ ok: true, ...result }));
  await writeFixture(cwd, "conversion.json", JSON.stringify(imported.document));
  await writeFixture(cwd, "docture.config.mjs", `const loaded=${JSON.stringify(imported.source.loaded)}; const png=Uint8Array.from(atob(${JSON.stringify(PNG)}),c=>c.charCodeAt(0)); loaded.pages=loaded.pages.map(page=>({...page,image:async()=>png})); export default {loaders:[{name:"native-images",capabilities:{text:true,geometry:false,images:true,mimeTypes:["application/pdf"],facts:["NATIVE_EVIDENCE"]},async load(){return loaded;}}]};`);
  const matching = await cli(["review", "--extraction", "saved.json", "--source", "original.pdf", "--out", "matched.html"], { cwd });
  expect(matching.code, matching.stderr).toBe(0);
  expect(await readFile(join(cwd, "matched.html"), "utf8")).toContain('<div class="line"');
  for (const flag of ["--extraction", "--conversion"]) {
    const mismatch = await cli(["review", flag, flag === "--extraction" ? "saved.json" : "conversion.json", "--source", "other.pdf", "--out", "mismatched.html"], { cwd });
    expect(mismatch.code).toBe(2);
    expect(mismatch.stderr).toContain("bound source digest");
  }
});

it("rejects malformed native evidence locations in a saved result", async () => {
  const { result } = await extraction();
  const cwd = await tempDir("native-evidence-invalid");
  const saved = JSON.parse(JSON.stringify({ ok: true, ...result }));
  saved.evidenceSources[0].location.box = { x: 0, y: 0, width: 10, height: 10 };
  await writeFixture(cwd, "saved.json", JSON.stringify(saved));
  await writeFixture(cwd, "original.pdf", "source");
  const reviewed = await cli(["review", "--extraction", "saved.json", "--source", "original.pdf", "--no-config"], { cwd });
  expect(reviewed.code).toBe(2);
  expect(reviewed.stderr).toContain("evidenceSources");
});

it("uses the configured Docling service loader in the normal CLI extraction path", async () => {
  const { outcome } = await extraction();
  let authenticated = false;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    authenticated = request.headers["x-api-key"] === "local-fixture";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "success", document: { json_content: raw }, errors: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture address");
  try {
    const cwd = await tempDir("native-service-config");
    await writeFixture(cwd, "input.pdf", "%PDF-1.7 local mock input");
    await writeFixture(cwd, "schema.json", JSON.stringify({ type: "object", properties: { subject: { type: "string" }, reading: { type: "number" } }, required: ["subject", "reading"] }));
    await writeFixture(cwd, "docture.config.mjs", `import {DocumentLoaderDoclingServe} from "docture/loaders/docling"; export default {loaders:[new DocumentLoaderDoclingServe({baseUrl:"http://127.0.0.1:${address.port}/",apiKey:"local-fixture"})],strategies:[{name:"configured-native",async extract(){return ${JSON.stringify(outcome)};}}]};`);
    const result = await cli(["extract", "input.pdf", "--schema", "schema.json", "--full", "--citations"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect(authenticated).toBe(true);
    const saved = JSON.parse(result.stdout);
    expect(saved.results[0].data).toEqual(outcome.data);
    expect(saved.results[0].evidenceSources[1].granularity).toBe("table-cell");
    expect(saved.results[0].citations.every((entry: { status: string }) => entry.status === "verified")).toBe(true);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
});
