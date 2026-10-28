import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { DocumentConverter, parseDoctureDocument } from "../../src/core/index.js";
import { richDocument } from "./conversion-fixtures.js";
import { acmeReport } from "./furniture-fixtures.js";

const schemaUrl = (version: number) =>
  new URL(`../../../../apps/docs/public/schemas/docture-document-v${version}.schema.json`, import.meta.url);

function v1Document() {
  return {
    schemaVersion: 1,
    loader: "DocumentLoaderPdfJs",
    method: "deterministic",
    pages: [{
      pageNumber: 1, width: 600, height: 800,
      elements: [{
        id: "p1-text-1", kind: "paragraph", text: "Hello", runs: [{ text: "Hello" }],
        provenance: { pageNumber: 1, box: { x: 40, y: 20, width: 25, height: 12 }, sourceIds: ["p1-text-1"] },
      }],
    }],
    assets: [],
    warnings: [],
  };
}

async function convertedJson(loaded = acmeReport()): Promise<Record<string, any>> {
  const result = await new DocumentConverter().convert({ loaded }, { format: "json" });
  return JSON.parse(result.content);
}

function edit(document: Record<string, any>, change: (copy: Record<string, any>) => void): Record<string, any> {
  const copy = structuredClone(document);
  change(copy);
  return copy;
}

let v2Validator: z.ZodType;
beforeAll(async () => {
  const schema = JSON.parse(await readFile(schemaUrl(2), "utf8").catch(() => "null"));
  v2Validator = schema === null ? z.never() : z.fromJSONSchema(schema);
});

describe("parseDoctureDocument", () => {
  it("accepts saved version 2 conversion output unchanged", async () => {
    const saved = await convertedJson();
    expect(parseDoctureDocument(saved)).toEqual({ ok: true, document: saved, sourceVersion: 2 });
  });

  it("reads a version 1 document as version 2", () => {
    expect(parseDoctureDocument(v1Document())).toEqual({
      ok: true, document: { ...v1Document(), schemaVersion: 2 }, sourceVersion: 1,
    });
  });

  it("rejects version 2 kinds and fields inside a version 1 document", () => {
    const furniture = edit(v1Document(), (copy) => {
      copy.pages[0].elements[0].kind = "page-header";
      copy.pages[0].elements[0].evidence = "repeated";
    });
    expect(parseDoctureDocument(furniture)).toEqual({
      ok: false, issues: [{ path: "pages.0.elements.0", message: "does not match any allowed shape" }],
    });
    const lineIds = edit(v1Document(), (copy) => { copy.pages[0].elements[0].provenance.lineIds = ["p1-line-1"]; });
    expect(parseDoctureDocument(lineIds)).toEqual({
      ok: false, issues: [{ path: "pages.0.elements.0.provenance.lineIds", message: "is not allowed" }],
    });
  });

  it("reports unknown versions and non-object input as one issue", () => {
    expect(parseDoctureDocument({ ...v1Document(), schemaVersion: 3 })).toEqual({
      ok: false, issues: [{ path: "schemaVersion", message: "must be 1 or 2" }],
    });
    expect(parseDoctureDocument("{}")).toEqual({ ok: false, issues: [{ path: "", message: "must be an object" }] });
    expect(parseDoctureDocument(null)).toEqual({ ok: false, issues: [{ path: "", message: "must be an object" }] });
  });

  it("reports shape errors with dotted paths", async () => {
    const saved = await convertedJson();
    const broken = edit(saved, (copy) => {
      copy.pages[0].pageNumber = 1.5;
      delete copy.pages[0].elements[0].runs;
      copy.pages[0].elements[1].provenance.lineIds = [];
      copy.pages[0].elements[2].evidence = "guessed";
      copy.pages[1].elements[0].provenance.lineIds = ["p2-text-1"];
      copy.extra = true;
    });
    expect(parseDoctureDocument(broken)).toEqual({
      ok: false,
      issues: [
        { path: "pages.0.pageNumber", message: "must be an integer" },
        { path: "pages.0.elements.0.runs", message: "is required" },
        { path: "pages.0.elements.1.provenance.lineIds", message: "must have at least 1 item" },
        { path: "pages.0.elements.2.evidence", message: 'must be "tagged" or "repeated"' },
        { path: "pages.1.elements.0.provenance.lineIds.0", message: "must match ^p[1-9]\\d*-line-[1-9]\\d*$" },
        { path: "extra", message: "is not allowed" },
      ],
    });
  });

  it("enforces cross-field rules the JSON Schema cannot express", async () => {
    const saved = await convertedJson();
    const broken = edit(saved, (copy) => {
      copy.pages[1].elements[0].id = "p1-336c32c7e8ed";
      copy.pages[1].elements[0].provenance.sourceIds = ["p1-text-1"];
      copy.pages[1].elements[1].provenance.pageNumber = 3;
      copy.pages[1].elements[2].provenance.lineIds = ["p1-line-3"];
    });
    expect(parseDoctureDocument(broken)).toEqual({
      ok: false,
      issues: [
        { path: "pages.1.elements.0.id", message: 'duplicates element id "p1-336c32c7e8ed"' },
        { path: "pages.1.elements.1.provenance.pageNumber", message: "must equal the holding page number 2" },
        { path: "pages.1.elements.1.provenance.lineIds.0", message: "must name a line on page 3" },
        { path: "pages.1.elements.2.provenance.lineIds.0", message: "must name a line on page 2" },
      ],
    });
  });

  it("agrees with the published version 2 JSON Schema on shape", async () => {
    const acme = await convertedJson();
    const rich = await convertedJson(richDocument());
    const corpus = [
      acme,
      rich,
      edit(acme, (copy) => { copy.schemaVersion = 1; }),
      edit(acme, (copy) => { delete copy.warnings; }),
      edit(acme, (copy) => { copy.pages[0].width = "600"; }),
      edit(acme, (copy) => { copy.pages[0].pageNumber = 0; }),
      edit(acme, (copy) => { copy.pages[0].pageNumber = 1.5; }),
      edit(acme, (copy) => { copy.pages[0].elements[0].kind = "banner"; }),
      edit(acme, (copy) => { copy.pages[0].elements[0].evidence = "guessed"; }),
      edit(acme, (copy) => { copy.pages[0].elements[0].provenance.lineIds = []; }),
      edit(acme, (copy) => { copy.pages[0].elements[0].provenance.lineIds = ["p1-line-01"]; }),
      edit(acme, (copy) => { copy.pages[0].elements[0].provenance.extra = 1; }),
      edit(rich, (copy) => { copy.pages[0].elements.find((e: any) => e.kind === "table").headerRows = -1; }),
      edit(rich, (copy) => { copy.assets = [{ id: "a", mimeType: "image/png", reference: "a.png", data: "AQID" }]; }),
      edit(rich, (copy) => { copy.warnings = [{ code: "UNKNOWN", message: "x" }]; }),
    ];
    expect(corpus.map((value) => parseDoctureDocument(value).ok))
      .toEqual(corpus.map((value) => v2Validator.safeParse(value).success));
    expect(corpus.map((value) => parseDoctureDocument(value).ok))
      .toEqual([true, true, false, false, false, false, false, false, false, false, false, false, false, false, false]);
  });

  it("keeps the published version 1 schema byte-identical", async () => {
    const bytes = await readFile(schemaUrl(1));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("22cfe02edfc0d46afa03545c19eb731da1bb1319427fd8d6539bdf5629dba8bd");
    const v1 = z.fromJSONSchema(JSON.parse(bytes.toString("utf8")));
    expect(v1.safeParse(v1Document()).success).toBe(true);
    expect(parseDoctureDocument(v1Document()).ok).toBe(true);
  });
});
