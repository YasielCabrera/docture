import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { DocumentConverter, parseDoctureDocument } from "docture";
import { chunkDocument } from "docture/chunk";
import { importDoclingDocument } from "../../src/import/docling/index.js";

async function pythonFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}-python.json`, import.meta.url), "utf8"));
}

it("imports a vertically merged native column header without crossing its normalized boundary", async () => {
  const imported = importDoclingDocument(await pythonFixture("vertical-header"));
  expect(imported.document.pages[0]?.elements[0]).toMatchObject({
    kind: "table", headerRows: 2, rows: [["Header"], [""], ["42"]],
    spans: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }],
  });
  const saved = parseDoctureDocument(JSON.parse(JSON.stringify(imported.document)));
  expect(saved.ok).toBe(true);
  const converted = await new DocumentConverter().convert(imported.source, { format: "html" });
  expect(converted.content).toContain('<th rowspan="2">Header</th>');
  expect(converted.content).toContain("<td>42</td>");
  expect(imported.source.loaded.pages[0]?.evidence?.map((source) => ({ text: source.text, granularity: source.granularity }))).toEqual([
    { text: "Header", granularity: "table-cell" }, { text: "42", granularity: "table-cell" },
  ]);
});

it("renders a native ordered list as one sequence while preserving each item's evidence and pointer", async () => {
  const imported = importDoclingDocument(await pythonFixture("list"));
  expect(imported.document.pages[0]?.elements).toMatchObject([
    { kind: "list", ordered: true, items: [{ text: "Collect", marker: "1. " }, { text: "Analyze", marker: "2. " }, { text: "Publish", marker: "3. " }] },
  ]);
  const converted = await new DocumentConverter().convert(imported.source, { format: "html" });
  expect(converted.content).toContain("<ol>\n<li>Collect</li>\n<li>Analyze</li>\n<li>Publish</li>\n</ol>");
  expect(converted.content.match(/<ol>/gu)).toHaveLength(1);
  const evidence = imported.source.loaded.pages[0]?.evidence ?? [];
  expect(evidence.map((source) => source.id)).toEqual([
    "p1-element-4bbd86db087f", "p1-element-12403220cd65", "p1-element-04611eeb2f6f",
  ]);
  expect(evidence.map((source) => ({ text: source.text, pointer: imported.provenance.sources[source.id]?.pointer }))).toEqual([
    { text: "Collect", pointer: "#/texts/0" }, { text: "Analyze", pointer: "#/texts/1" }, { text: "Publish", pointer: "#/texts/2" },
  ]);
  expect(evidence.map((source) => source.elementId)).toEqual(evidence.map(() => imported.document.pages[0]?.elements[0]?.id));
  expect(evidence.map((source) => imported.provenance.sources[source.elementId]?.pointer)).toEqual(["#/groups/0", "#/groups/0", "#/groups/0"]);
  const saved = parseDoctureDocument(JSON.parse(JSON.stringify(imported.document)));
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(JSON.stringify(saved.issues));
  expect(chunkDocument(saved.document, { budget: { unit: "characters", max: 500 } }).flatMap((chunk) => chunk.evidence ?? []).map((source) => source.text)).toEqual(["Collect", "Analyze", "Publish"]);
  expect(imported.source.loaded.pages[0]?.lines).toBeUndefined();
});

it("keeps adjacent native list groups as separate ordered sequences", async () => {
  const imported = importDoclingDocument(await pythonFixture("separate-lists"));
  expect(imported.document.pages[0]?.elements).toMatchObject([
    { kind: "list", ordered: true, items: [{ text: "Collect" }, { text: "Analyze" }] },
    { kind: "list", ordered: true, items: [{ text: "Publish" }, { text: "Archive" }] },
  ]);
  const converted = await new DocumentConverter().convert(imported.source, { format: "html" });
  expect(converted.content.match(/<ol>/gu)).toHaveLength(2);
  expect(imported.source.loaded.text).toBe("Collect\nAnalyze\nPublish\nArchive");
});

it.each([
  ["nested-list", "UNSUPPORTED_LIST_NESTING"],
  ["continued-list", "UNSUPPORTED_LIST_NUMBERING"],
])("diagnoses unsupported %s presentation while retaining its native evidence", async (fixture, code) => {
  const raw = await pythonFixture(fixture);
  const imported = importDoclingDocument(raw);
  expect(imported.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  expect(imported.source.loaded.text).toBe(fixture === "nested-list" ? "Collect\nCheck\nPublish" : "Publish\nArchive");
  expect(imported.source.loaded.pages[0]?.evidence?.map((source) => imported.provenance.sources[source.id]?.pointer)).toEqual(fixture === "nested-list" ? ["#/texts/0", "#/texts/1", "#/texts/2"] : ["#/texts/0", "#/texts/1"]);
  const converted = await new DocumentConverter().convert(imported.source, { format: "json" });
  expect(JSON.parse(converted.content).warnings).toEqual(imported.document.warnings);
  expect(() => importDoclingDocument(raw, { strict: true })).toThrow(fixture === "nested-list" ? "Nested native list groups" : "Normalized ordered lists start at 1");
});
