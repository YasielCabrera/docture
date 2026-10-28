import { describe, expect, it, vi } from "vitest";
import {
  DocumentConverter,
  parseDoctureDocument,
  withOcrFallback,
  type ConversionFormat,
  type ConversionResult,
  type ConversionWarning,
  type DocumentLoader,
  type LayoutAnnotation,
  type SourceEvidence,
} from "docture";
import { chunkDocument } from "docture/chunk";
import { importDoclingDocument } from "docture/import/docling";
import { nativeDocument } from "../import/docling-fixtures.js";

const bytes = new Uint8Array([37, 80, 68, 70]);
const capabilities = { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] };
const budget = { budget: { unit: "characters", max: 500 } } satisfies Parameters<typeof chunkDocument>[1];

function savedDocument(result: ConversionResult) {
  const parsed = parseDoctureDocument(JSON.parse(result.content));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.document;
}

describe("native conversion preservation", () => {
  it.each([false, true])("retains loader conversion diagnostics with mixed layout %s", async (mixed) => {
    const imported = importDoclingDocument(nativeDocument());
    const warning = { code: "LAYOUT_DEGRADED", message: "Native conversion supplied partial layout." } satisfies ConversionWarning;
    const converter = new DocumentConverter();
    try {
      const result = await converter.convert({
        ...imported.source,
        loaded: {
          ...imported.source.loaded,
          conversionWarnings: [warning],
          pages: imported.source.loaded.pages.map((page) => mixed && page.pageNumber === 5
            ? { pageNumber: 5, width: 0, height: 0, text: "Recovered scan" } : page),
        },
      }, { format: "json" });
      expect(result.warnings).toEqual([
        warning,
        ...(mixed ? [{ code: "LAYOUT_DEGRADED", message: "Page 5 has no loader-provided layout blocks or lines.", pageNumber: 5 }] : []),
      ]);
      expect(savedDocument(result).warnings).toEqual(result.warnings);
    } finally { await converter.dispose(); }
  });

  it("keeps untouched native structure, evidence, and source binding when OCR replaces another page", async () => {
    const imported = importDoclingDocument(nativeDocument(), {
      coordinateSpace: { unit: "points" },
      physicalSource: { bytes, attestExportMatchesSource: true },
    });
    const primary: DocumentLoader = { name: "native", capabilities, async load() { return imported.source.loaded; } };
    const recognize = vi.fn<DocumentLoader["load"]>(async () => ({
      loader: "ocr", form: "scanned", text: "Recovered scanned page",
      pages: [{ pageNumber: 5, width: 600, height: 800, text: "Recovered scanned page" }],
    }));
    const converter = new DocumentConverter({ loaders: [withOcrFallback(primary, {
      name: "ocr", capabilities, load: recognize,
    }, { threshold: 10, assess: (page) => ({ kind: "text", quality: page.text.length }) })] });
    try {
      const result = await converter.convert({ bytes, mimeType: "application/pdf" }, { format: "json" });
      const saved = savedDocument(result);
      expect(recognize.mock.calls.map(([, context]) => context.request?.pages)).toEqual([[5]]);
      expect(saved.pages.map((page) => page.pageNumber)).toEqual([2, 5]);
      expect(saved.pages[0]).toEqual(imported.document.pages[0]);
      expect(saved.pages[0]?.elements.map((element) => element.kind)).toEqual(["heading", "paragraph", "table", "page-header"]);
      expect(saved.sourceDigest).toBe(imported.document.sourceDigest);
      expect(saved.physicalSourceDigest).toBe(imported.document.physicalSourceDigest);
      expect(saved.pages[1]?.elements).toMatchObject([{ kind: "paragraph", text: "Recovered scanned page", provenance: { pageNumber: 5 } }]);
      expect(result.warnings).toEqual([{ code: "LAYOUT_DEGRADED", message: "Page 5 has no loader-provided layout blocks or lines.", pageNumber: 5 }]);
      expect(chunkDocument(result, budget).flatMap((chunk) => chunk.evidence ?? []).map((source) => source.text))
        .toEqual(["Lab report", "Pressure report 😀AlphaBeta", "Measurements", "Pressure", "100"]);
    } finally { await converter.dispose(); }
  });

  it("preserves native cross-page tables when a later scanned page needs reconstruction", async () => {
    const raw = nativeDocument();
    raw.pages["3"] = { page_no: 3, size: { width: 600, height: 800 } };
    const first = raw.tables[0]?.prov[0];
    if (first === undefined) throw new Error("fixture table is missing");
    raw.tables[0]?.prov.push({ ...first, page_no: 3 });
    const imported = importDoclingDocument(raw);
    const source = {
      ...imported.source,
      loaded: {
        ...imported.source.loaded,
        text: `${imported.source.loaded.text}Recovered scan`,
        pages: imported.source.loaded.pages.map((page) => page.pageNumber === 5
          ? { pageNumber: 5, width: 600, height: 800, text: "Recovered scan" }
          : page),
      },
    };
    const converter = new DocumentConverter();
    try {
      const saved = savedDocument(await converter.convert(source, { format: "json" }));
      expect(saved.pages.map((page) => page.pageNumber)).toEqual([2, 3, 5]);
      expect(saved.pages.slice(0, 2)).toEqual(imported.document.pages.slice(0, 2));
      const table = saved.pages[0]?.elements.find((element) => element.kind === "table");
      expect(table?.provenance.continuations).toMatchObject([{ pageNumber: 3, sourceIds: ["#/tables/0"] }]);
      expect(saved.pages[0]?.evidence?.find((source) => source.text === "100")?.location)
        .toEqual({ kind: "unlocated", pageNumbers: [2, 3] });
    } finally { await converter.dispose(); }
  });

  it("keeps continuation-page evidence attached when layout suggestions target a continued native table", async () => {
    const raw = nativeDocument();
    raw.pages["3"] = { page_no: 3, size: { width: 600, height: 800 } };
    const first = raw.tables[0]?.prov[0];
    if (first === undefined) throw new Error("fixture table is missing");
    raw.tables[0]?.prov.push({ ...first, page_no: 3 });
    const imported = importDoclingDocument(raw);
    const cell = imported.document.pages[0]?.evidence?.find((source) => source.granularity === "table-cell" && source.text === "100");
    if (cell === undefined || cell.granularity !== "table-cell") throw new Error("fixture cell is missing");
    const continued = {
      ...cell, id: "p3-cell-0123456789ab", pageNumber: 3, order: 6,
      location: { kind: "logical", pageNumber: 3 },
    } satisfies SourceEvidence;
    const converter = new DocumentConverter({ layoutAnalyzer: {
      name: "regroup-table",
      async analyze(context) {
        return { annotations: context.document.pages.flatMap((page) => page.elements)
          .filter((element) => element.kind === "table").map((element) => ({ id: element.id, role: "paragraph", group: "tables" } satisfies LayoutAnnotation)) };
      },
    } });
    try {
      const result = await converter.convert({
        ...imported.source,
        loaded: { ...imported.source.loaded, pages: imported.source.loaded.pages.map((page) =>
          page.pageNumber === 3 ? { ...page, evidence: [continued] } : page) },
      }, { format: "json" });
      expect(result.method).toBe("deterministic+regroup-table");
      const saved = savedDocument(result);
      expect(saved.pages[1]?.evidence).toEqual([continued]);
      const table = saved.pages[0]?.elements.find((element) => element.kind === "table");
      expect(table).toEqual(imported.document.pages[0]?.elements.find((element) => element.kind === "table"));
      expect(chunkDocument(result, budget).flatMap((chunk) => chunk.evidence ?? []).find((source) => source.id === continued.id))
        .toEqual(continued);
    } finally { await converter.dispose(); }
  });

  it.each(["text", "markdown", "html", "json"] satisfies ConversionFormat[])(
    "retains the same native evidence when chunking an in-process %s result and saved JSON",
    async (format) => {
      const imported = importDoclingDocument(nativeDocument());
      const converter = new DocumentConverter();
      try {
        const result = await converter.convert(imported.source, { format });
        const saved = savedDocument(await converter.convert(imported.source, { format: "json" }));
        expect(result.pages[0]?.evidence).toEqual(imported.document.pages[0]?.evidence);
        const direct = chunkDocument(result, budget);
        const restored = chunkDocument(saved, budget);
        expect(direct).toEqual(restored);
        expect(direct.flatMap((chunk) => chunk.evidence ?? []).map((source) => source.text))
          .toEqual(["Lab report", "Pressure report 😀AlphaBeta", "Measurements", "Pressure", "100"]);
      } finally { await converter.dispose(); }
    },
  );

  it("rebases grouped paragraph evidence without changing native IDs, text, locations, or pointers", async () => {
    const raw = nativeDocument();
    const heading = raw.texts[0];
    if (heading === undefined) throw new Error("fixture heading is missing");
    heading.label = "text";
    const imported = importDoclingDocument(raw);
    const paragraphs = imported.document.pages[0]?.elements.filter((element) => element.kind === "paragraph") ?? [];
    const first = paragraphs[0];
    if (first === undefined) throw new Error("fixture paragraph is missing");
    const converter = new DocumentConverter({ layoutAnalyzer: {
      name: "merge-paragraphs",
      async analyze(context) {
        return { annotations: context.document.pages.flatMap((page) => page.elements)
          .filter((element) => element.kind === "paragraph").map((element) => ({ id: element.id, group: "paragraphs" })) };
      },
    } });
    try {
      const result = await converter.convert(imported.source, { format: "json" });
      expect(result.method).toBe("deterministic+merge-paragraphs");
      const saved = savedDocument(result);
      const merged = saved.pages[0]?.elements.find((element) => element.kind === "paragraph");
      expect(merged).toMatchObject({ id: first.id, text: "Lab report\nPressure report 😀AlphaBeta", provenance: { sourceIds: ["#/texts/0", "#/texts/1"] } });
      const paragraphIds = new Set(paragraphs.map((element) => element.id));
      expect(saved.pages[0]?.evidence).toEqual(imported.document.pages[0]?.evidence?.map((source) =>
        paragraphIds.has(source.elementId) ? { ...source, elementId: first.id } : source));
      const evidence = chunkDocument(result, budget).flatMap((chunk) => chunk.evidence ?? []);
      expect(evidence.map((source) => source.text)).toEqual(["Lab report", "Pressure report 😀AlphaBeta", "Measurements", "Pressure", "100"]);
      expect(evidence.map((source) => imported.provenance.sources[source.id]?.pointer))
        .toEqual(["#/texts/0", "#/texts/1", "#/tables/0/data/table_cells/0", "#/tables/0/data/table_cells/1", "#/tables/0/data/table_cells/2"]);
      expect(imported.source.loaded.pages[0]?.layout?.filter((element) => element.kind === "paragraph")).toHaveLength(2);
    } finally { await converter.dispose(); }
  });

  it("rebases grouped table cells to their appended rows while keeping native source identity", async () => {
    const raw = nativeDocument();
    const table = raw.tables[0];
    if (table === undefined) throw new Error("fixture table is missing");
    raw.tables.push({
      ...table, self_ref: "#/tables/1",
      data: { ...table.data, table_cells: table.data.table_cells.map((cell, index) => ({ ...cell, text: ["Other measurements", "Temperature", "22"][index] ?? cell.text })) },
    });
    raw.body.children.push({ $ref: "#/tables/1" });
    const imported = importDoclingDocument(raw);
    const first = imported.document.pages[0]?.elements.find((element) => element.kind === "table");
    if (first === undefined) throw new Error("imported table is missing");
    const converter = new DocumentConverter({ layoutAnalyzer: {
      name: "merge-tables",
      async analyze(context) {
        return { annotations: context.document.pages.flatMap((page) => page.elements)
          .filter((element) => element.kind === "table").map((element) => ({ id: element.id, group: "tables" })) };
      },
    } });
    try {
      const result = await converter.convert(imported.source, { format: "json" });
      const saved = savedDocument(result);
      const merged = saved.pages[0]?.elements.find((element) => element.kind === "table");
      expect(merged?.rows).toEqual([["Measurements", ""], ["Pressure", "100"], ["Other measurements", ""], ["Temperature", "22"]]);
      const cells = saved.pages[0]?.evidence?.filter((source) => source.granularity === "table-cell") ?? [];
      expect(cells.map((source) => [source.elementId, source.row, source.column, source.text])).toEqual([
        [first.id, 0, 0, "Measurements"], [first.id, 1, 0, "Pressure"], [first.id, 1, 1, "100"],
        [first.id, 2, 0, "Other measurements"], [first.id, 3, 0, "Temperature"], [first.id, 3, 1, "22"],
      ]);
      expect(cells.map((source) => source.id)).toEqual(imported.document.pages[0]?.evidence?.filter((source) => source.granularity === "table-cell").map((source) => source.id));
      const chunks = chunkDocument(result, { budget: { unit: "characters", max: 40 } });
      expect([...new Set(chunks.flatMap((chunk) => chunk.evidence ?? []).map((source) => source.text))])
        .toEqual(["Lab report", "Pressure report 😀AlphaBeta", "Measurements", "Pressure", "100", "Other measurements", "Temperature", "22"]);
      for (const chunk of chunks) {
        for (const source of chunk.evidence ?? []) expect(chunk.text).toContain(source.text);
      }
    } finally { await converter.dispose(); }
  });
});
