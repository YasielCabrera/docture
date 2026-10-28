import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DocumentConverter, DocumentLoaderData, type ConversionAssetMode, type DoctureDocument,
} from "../../src/core/index.js";

async function parseDocument(mode: ConversionAssetMode = "referenced") {
  const result = await new DocumentConverter().convert({
    loaded: {
      loader: "json-fixture", form: "digital", text: "Visible text",
      pages: [{
        pageNumber: 2, width: 600, height: 800, text: "Visible text",
        assets: [{
          id: "picture", name: "picture.png", pageNumber: 2, mimeType: "image/png",
          bytes: new Uint8Array([1, 2, 3]), x: 0, y: 0, width: 1, height: 1,
        }],
      }],
    },
    fileName: "sample.pdf",
  }, { format: "json", assets: mode });
  expect(result.mimeType).toBe("application/json");
  const document: DoctureDocument = JSON.parse(result.content);
  return { result, document };
}

describe("versioned conversion", () => {
  it("exports version, dimensions, elements, provenance and final warnings", async () => {
    const { result, document } = await parseDocument();
    expect(document.schemaVersion).toBe(2);
    expect(document.loader).toBe("json-fixture");
    expect(document.method).toBe("deterministic");
    expect(document.pages.map((p) => ({ pageNumber: p.pageNumber, width: p.width, height: p.height })))
      .toEqual([{ pageNumber: 2, width: 600, height: 800 }]);
    expect(document.pages.map((p) => p.elements)).toEqual(result.pages.map((p) => p.elements));
    expect(document.pages[0]?.elements[0]?.provenance).toEqual({
      pageNumber: 2, box: { x: 0, y: 0, width: 0, height: 0 }, sourceIds: ["p2-paragraph-1"],
    });
    expect(document.warnings).toEqual([{
      code: "LAYOUT_DEGRADED", message: "Page 2 has no loader-provided layout blocks or lines.", pageNumber: 2,
    }]);
    expect(document.warnings).toEqual(result.warnings);
    expect(JSON.parse(result.pages[0]?.content ?? "null")).toEqual(document.pages[0]);
  });

  it.each([
    { mode: "referenced", expected: [{ id: "picture", mimeType: "image/png", reference: "sample.assets/page-2-image-1.png" }] },
    { mode: "embedded", expected: [{ id: "picture", mimeType: "image/png", data: "AQID" }] },
    { mode: "omit", expected: [] },
  ] satisfies { mode: ConversionAssetMode; expected: unknown[] }[])(
    "encodes $mode assets without serializing byte-array objects",
    async ({ mode, expected }) => {
      const { document } = await parseDocument(mode);
      expect(document.assets).toEqual(expected);
    },
  );

  it("keeps analyzer and asset warnings exactly once", async () => {
    const result = await new DocumentConverter({
      layoutAnalyzer: { name: "failed", async analyze() { throw new Error("offline"); } },
    }).convert({
      loaded: {
        loader: "warnings", form: "digital", text: "Text",
        pages: [{
          pageNumber: 1, width: 0, height: 0, text: "Text",
          assets: [{
            id: "bad", name: "bad.bin", pageNumber: 1, mimeType: "application/octet-stream",
            bytes: new Uint8Array([0]), x: 0, y: 0, width: 1, height: 1,
          }],
        }],
      },
    }, { format: "json" });
    expect(result.mimeType).toBe("application/json");
    const document: DoctureDocument = JSON.parse(result.content);
    expect(document.warnings.map((warning) => warning.code))
      .toEqual(["LAYOUT_DEGRADED", "LAYOUT_ANALYZER_FAILED", "UNSUPPORTED_ASSET"]);
    expect(document.warnings).toEqual(result.warnings);
  });
});

describe("document schema", () => {
  it("validates conversion output and rejects malformed versions, elements and assets", async () => {
    const { document } = await parseDocument();
    const schema = JSON.parse(await readFile(
      new URL("../../../../apps/docs/public/schemas/docture-document-v2.schema.json", import.meta.url), "utf8",
    ));
    const validator = z.fromJSONSchema(schema);
    expect(validator.safeParse(document).success).toBe(true);
    expect(validator.safeParse({ ...document, schemaVersion: 1 }).success).toBe(false);
    expect(validator.safeParse({ ...document, schemaVersion: 3 }).success).toBe(false);
    expect(validator.safeParse({ ...document, pages: [{ ...document.pages[0], elements: [{ kind: "unknown" }] }] }).success).toBe(false);
    expect(validator.safeParse({
      ...document, pages: [{ ...document.pages[0], elements: [{ ...document.pages[0]?.elements[0], provenance: {} }] }],
    }).success).toBe(false);
    expect(validator.safeParse({ ...document, assets: [{ id: "x", mimeType: "image/png", reference: "a.png", data: "AQID" }] }).success).toBe(false);
    const result = await new DocumentConverter({ loaders: [new DocumentLoaderData()] })
      .convert({ bytes: new TextEncoder().encode("First\fSecond"), mimeType: "text/plain" }, { format: "json" });
    expect(result.mimeType).toBe("application/json");
    expect(validator.safeParse(JSON.parse(result.content)).success).toBe(true);
  });
});
