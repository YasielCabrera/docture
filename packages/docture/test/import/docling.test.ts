import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DocumentConverter, DocumentLoaderData, Extractor, errorCodeOf, parseDoctureDocument } from "docture";
import { chunkDocument } from "docture/chunk";
import { llm } from "docture/llm/text";
import { scoreExtraction } from "docture/eval";
import { importDoclingDocument, DoclingImportError } from "../../src/import/docling/index.js";
import { mockModel } from "../llm/mock-model.js";
import { nativeDocument } from "./docling-fixtures.js";

describe("Docling native JSON import", () => {
  it("rejects native text whose charspans silently omit source content", () => {
    const raw = nativeDocument();
    const item = raw.texts[1];
    if (item?.prov[0] === undefined) throw new Error("fixture");
    item.prov[0].charspan = [0, 5];
    expect(() => importDoclingDocument(raw)).toThrow("do not cover the complete native text");
  });

  it("rejects overlapping text spans instead of duplicating authoritative text", () => {
    const raw = nativeDocument();
    const item = raw.texts[1];
    if (item?.prov[0] === undefined) throw new Error("fixture");
    item.prov.push(structuredClone(item.prov[0]));
    expect(() => importDoclingDocument(raw)).toThrow("overlapping charspans");
  });

  it("normalizes repeated table boxes on one page into a valid saved document", () => {
    const raw = nativeDocument();
    const table = raw.tables[0];
    if (table?.prov[0] === undefined) throw new Error("fixture");
    table.prov.push(structuredClone(table.prov[0]));
    const imported = importDoclingDocument(raw);
    expect(parseDoctureDocument(JSON.parse(JSON.stringify(imported.document))).ok).toBe(true);
    expect(imported.source.loaded.text).toContain("Measurements");
  });

  it("imports a real pinned Python export and its service envelope with matching provenance", async () => {
    const python = JSON.parse(await readFile(new URL("./fixtures/report-python.json", import.meta.url), "utf8"));
    const service = JSON.parse(await readFile(new URL("./fixtures/report-service.json", import.meta.url), "utf8"));
    const imported = importDoclingDocument(python);
    expect(importDoclingDocument(service.document.json_content)).toEqual(imported);
    expect(imported.provenance.schemaVersion).toBe("1.10.0");
    expect(imported.document.pages.map((page) => page.pageNumber)).toEqual([2, 5]);
    const saved = parseDoctureDocument(JSON.parse(JSON.stringify(imported.document)));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(JSON.stringify(saved.issues));
    const chunks = chunkDocument(saved.document, { budget: { unit: "characters", max: 200 } });
    expect(chunks.flatMap((chunk) => chunk.evidence ?? []).some((entry) => entry.granularity === "table-cell" && entry.text === "100")).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.provenance).map((segment) => segment.pageNumber)).toContain(5);
  });

  it("extracts a short native value with coherent form and no geometry claim", async () => {
    const raw = nativeDocument();
    const item = raw.texts[0];
    if (item === undefined) throw new Error("fixture");
    item.text = "42"; item.label = "text"; item.prov = [];
    raw.texts = [item]; raw.tables = []; raw.pages = {};
    raw.body.children = [{ $ref: "#/texts/0" }]; raw.furniture.children = [];
    const imported = importDoclingDocument(raw);
    expect(imported.source.loaded.form).toBe("digital");
    const source = imported.source.loaded.pages[0]?.evidence?.[0];
    const { model } = mockModel([{ data: { value: 42 }, citations: [{ path: "value", ids: [source?.id] }] }]);
    const result = await new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model, citations: true })] }).extract(imported.source, z.object({ value: z.number() }));
    expect(result.data).toEqual({ value: 42 });
    expect(result.sourceDigest).toBe(imported.provenance.sourceDigest);
    expect(result.sourceMetadata).toMatchObject({ doclingProvenance: { sources: { [source?.id ?? ""]: { pointer: "#/texts/0" } } } });
    expect(result.citations?.[0]?.status).toBe("verified");
    expect(result.features.hasGeometry).toBe(false);
  });
  it("preserves hierarchy, table spans, furniture and evidence through saved JSON and chunks", async () => {
    const raw = nativeDocument();
    const imported = importDoclingDocument(raw);
    expect(imported.document.pages.map((page) => page.pageNumber)).toEqual([2, 5]);
    expect(imported.document.pages[0]?.elements.map((element) => element.kind)).toEqual(["heading", "paragraph", "table", "page-header"]);
    expect(imported.document.pages[0]?.elements[2]).toMatchObject({ kind: "table", rows: [["Measurements", ""], ["Pressure", "100"]], spans: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }] });
    expect(imported.source.loaded.pages.every((page) => page.lines === undefined)).toBe(true);
    const saved = parseDoctureDocument(JSON.parse(JSON.stringify(imported.document)));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(JSON.stringify(saved.issues));
    expect(saved.document.sourceDigest).toBe(imported.provenance.sourceDigest);
    const chunks = chunkDocument(saved.document, { budget: { unit: "characters", max: 500 } });
    expect(chunks.flatMap((chunk) => chunk.evidence ?? []).some((source) => source.granularity === "table-cell" && source.text === "100")).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.provenance).some((segment) => segment.sourceIds.includes("#/tables/0"))).toBe(true);
    const converted = await new DocumentConverter().convert(imported.source, { format: "json" });
    expect(JSON.parse(converted.content).pages[0].elements[2].kind).toBe("table");
    expect(importDoclingDocument(structuredClone(raw))).toEqual(imported);
  });

  it.each(["report", "letter"] as const)("extracts an arbitrary %s schema against real element and cell evidence", async (kind) => {
    const imported = importDoclingDocument(nativeDocument(kind));
    const evidence = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []);
    const heading = evidence.find((entry) => entry.text === (kind === "report" ? "Lab report" : "Appointment letter"));
    const cell = evidence.find((entry) => entry.text === (kind === "report" ? "100" : "42"));
    expect(heading).toBeDefined(); expect(cell).toBeDefined();
    const data = { subject: heading?.text, reading: kind === "report" ? 100 : 42, derived: "unknown", missing: "without a citation" };
    const { model, calls } = mockModel([{ data, citations: [{ path: "subject", ids: [heading?.id] }, { path: "reading", ids: [cell?.id] }, { path: "derived", ids: [cell?.id] }] }]);
    const extractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model, citations: true })] });
    const result = await extractor.extract(imported.source, z.object({ subject: z.string(), reading: z.number(), derived: z.string(), missing: z.string() }));
    expect(result.data).toEqual(data);
    expect(result.features.hasGeometry).toBe(false);
    expect(result.citations?.map((entry) => entry.status)).toEqual(["verified", "verified", "cited-unverified", "uncited"]);
    expect(result.citationSources).toEqual([]);
    expect(result.evidenceSources?.map((entry) => entry.granularity)).toEqual(["element", "table-cell"]);
    expect(JSON.stringify(calls[0]?.prompt)).toContain(cell?.id);
    expect(result.evidenceSources?.every((entry) => entry.location.kind !== "physical")).toBe(true);
  });

  it("keeps physical geometry behind explicit source binding and normalizes known coordinate origins", () => {
    const raw = nativeDocument();
    const bound = importDoclingDocument(raw, { coordinateSpace: { unit: "points" }, physicalSource: { bytes: new Uint8Array([1, 2, 3]), attestExportMatchesSource: true } });
    const paragraph = bound.source.loaded.pages[0]?.evidence?.find((entry) => entry.text.startsWith("Pressure report"));
    expect(paragraph?.location).toMatchObject({ kind: "physical", pageNumber: 2, box: { x: 10, y: 720, width: 390, height: 20 } });
    expect(bound.provenance.physicalSourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(importDoclingDocument(raw, { coordinateSpace: { unit: "points" } }).source.loaded.pages[0]?.evidence?.every((entry) => entry.location.kind !== "physical")).toBe(true);
  });

  it("splits multipage Unicode evidence at native codepoint spans without inventing lines", () => {
    const raw = nativeDocument();
    const text = raw.texts[1];
    if (text === undefined) throw new Error("fixture");
    text.text = "😀AlphaBeta";
    text.prov = [
      { page_no: 2, bbox: { l: 1, t: 1, r: 20, b: 10, coord_origin: "TOPLEFT" }, charspan: [0, 6] },
      { page_no: 5, bbox: { l: 1, t: 1, r: 20, b: 10, coord_origin: "TOPLEFT" }, charspan: [6, 10] },
    ];
    const imported = importDoclingDocument(raw);
    const pieces = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []).filter((entry) => entry.text === "😀Alpha" || entry.text === "Beta");
    expect(pieces.map((entry) => [entry.pageNumber, entry.text])).toEqual([[2, "😀Alpha"], [5, "Beta"]]);
    expect(Object.values(imported.provenance.sources).some((entry) => entry.utf16Charspan?.[1] === 7)).toBe(true);
    expect(parseDoctureDocument(imported.document).ok).toBe(true);
  });

  it("imports unpositioned logical pages and explicitly unlocated multipage cells", () => {
    const raw = nativeDocument();
    raw.pages = {};
    for (const text of raw.texts) text.prov = [];
    const table = raw.tables[0];
    if (table !== undefined) table.prov = [];
    const imported = importDoclingDocument(raw);
    expect(imported.document.pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(imported.diagnostics.some((entry) => entry.code === "LOGICAL_PAGES")).toBe(true);
    expect(imported.source.loaded.pages[0]?.evidence?.every((entry) => entry.location.kind === "logical")).toBe(true);
    const multiple = nativeDocument();
    const first = multiple.tables[0]?.prov[0];
    if (first !== undefined) multiple.tables[0]?.prov.push({ ...first, page_no: 5 });
    const source = importDoclingDocument(multiple).source.loaded.pages.flatMap((page) => page.evidence ?? []).find((entry) => entry.text === "100");
    expect(source?.location).toEqual({ kind: "unlocated", pageNumbers: [2, 5] });
  });

  it("repairs a validation-rule failure against the same native evidence and scores the final data", async () => {
    const imported = importDoclingDocument(nativeDocument());
    const cell = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []).find((entry) => entry.text === "100");
    const { model, calls } = mockModel([
      { data: { reading: 99 }, citations: [{ path: "reading", ids: [cell?.id] }] },
      { data: { reading: 100 }, citations: [{ path: "reading", ids: [cell?.id] }] },
    ]);
    const extractor = new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model, citations: true })] });
    const result = await extractor.extract(imported.source, z.object({ reading: z.number() }), { onRuleFailure: "fail", maxRepairs: 1, rules: [(data) => data.reading === 100 ? [] : [{ path: "reading", message: "expected the measured 100" }]] });
    expect(result.data).toEqual({ reading: 100 });
    expect(result.citations?.[0]).toMatchObject({ status: "verified", ids: [cell?.id] });
    expect(result.attempts.filter((attempt) => attempt.stage === "repair")).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(scoreExtraction({ reading: 100 }, result.data).exactMatch).toBe(true);
  });

  it("keeps verified native citations and conflicts when page answers disagree", async () => {
    const raw = nativeDocument();
    const other = raw.texts[1];
    if (other === undefined) throw new Error("fixture");
    other.text = "Second reading 101";
    if (other.prov[0] !== undefined) { other.prov[0].page_no = 5; other.prov[0].charspan = [0, 18]; }
    const imported = importDoclingDocument(raw);
    const cells = imported.source.loaded.pages.flatMap((page) => page.evidence ?? []);
    const first = cells.find((entry) => entry.text === "100"); const second = cells.find((entry) => entry.text === "Second reading 101");
    const { model } = mockModel([
      { data: { reading: 100 }, citations: [{ path: "reading", ids: [first?.id] }] },
      { data: { reading: 101 }, citations: [{ path: "reading", ids: [second?.id] }] },
    ]);
    const result = await new Extractor({ loaders: [new DocumentLoaderData()], strategies: [llm({ model, citations: true, completion: "paginate", concurrency: 1 })] }).extract(imported.source, z.object({ reading: z.number() }));
    expect(result.conflicts).toMatchObject([{ path: "reading", values: [{ value: 100, pages: [2] }, { value: 101, pages: [5] }] }]);
    expect(result.citations?.[0]?.status).toBe("verified");
  });

  it("scales image coordinates only with explicit units and binding and withholds rotated boxes", () => {
    const raw = nativeDocument();
    const options = { coordinateSpace: { unit: "pixels", pixelsPerPoint: 2 } as const, physicalSource: { bytes: new Uint8Array([1, 2, 3]), attestExportMatchesSource: true } as const };
    const imported = importDoclingDocument(raw, options);
    expect(imported.source.loaded.pages[0]?.evidence?.[0]?.location).toMatchObject({ kind: "physical", box: { x: 5, y: 10, width: 145, height: 10 } });
    if (raw.pages["2"] !== undefined) raw.pages["2"].rotation = 90;
    expect(importDoclingDocument(raw, options).source.loaded.pages[0]?.evidence?.every((entry) => entry.location.kind !== "physical")).toBe(true);
    expect(() => importDoclingDocument(raw, { ...options, pageImages: [{ pageNumber: 2, bytes: new Uint8Array([1]), sourceDigest: "sha256:wrong" }] })).toThrow(DoclingImportError);
  });

  it("rejects a native table that skips an existing page and malformed persisted evidence", () => {
    const raw = nativeDocument();
    raw.pages["3"] = { page_no: 3, size: { width: 600, height: 800 } };
    const first = raw.tables[0]?.prov[0];
    if (first !== undefined) raw.tables[0]?.prov.push({ ...first, page_no: 5 });
    expect(() => importDoclingDocument(raw)).toThrow("may not skip");
    const imported = importDoclingDocument(nativeDocument());
    const saved = JSON.parse(JSON.stringify(imported.document));
    saved.pages[0].evidence[0].elementId = "missing-element";
    expect(parseDoctureDocument(saved).ok).toBe(false);
  });

  it.each(["version", "broken", "cycle", "span", "box", "limit"])("rejects invalid %s input with stable typed diagnostics", (kind) => {
    const raw = nativeDocument();
    if (kind === "version") raw.version = "2.0.0";
    if (kind === "broken") raw.body.children[0] = { $ref: "#/texts/99" };
    if (kind === "cycle") raw.body.children[0] = { $ref: "#/body" };
    if (kind === "span" && raw.texts[0]?.prov[0] !== undefined) raw.texts[0].prov[0].charspan = [0, 999];
    if (kind === "box" && raw.texts[0]?.prov[0] !== undefined) raw.texts[0].prov[0].bbox.r = -1;
    expect(() => importDoclingDocument(raw, kind === "limit" ? { limits: { maxNodes: 2 } } : {})).toThrow(DoclingImportError);
    try { importDoclingDocument(raw, kind === "limit" ? { limits: { maxNodes: 2 } } : {}); } catch (error) { expect(errorCodeOf(error)).toBe("UNSUPPORTED_SOURCE"); }
  });
});
