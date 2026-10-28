import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DocumentConverter, DocumentLoaderData, parseDoctureDocument, type ConversionAssetMode,
} from "../../src/core/index.js";
import { DocumentLoaderPdfJs } from "../../src/loaders/pdfjs/index.js";
import { DocumentLoaderMuPdf } from "../../src/loaders/mupdf/index.js";
import { makeRichDocumentPdf } from "../../src/testing/fixtures/index.js";
import { block, line, span, listDocument, richDocument } from "./conversion-fixtures.js";

const modes: readonly ConversionAssetMode[] = ["referenced", "embedded", "omit"];
const text = "OCR grounded text";
const ocrLine = line(40, [span(text, 20, 40, { confidence: 0.91 })]);
const columnBlocks = [
  block("# grounded paragraph", 40), block("Right one", 50),
  block("Left two", 90), block("Right two", 100),
].map((item, index) => ({ ...item, x: index % 2 === 0 ? 20 : 330 }));
const fixtures = [
  { name: "rich layout", document: richDocument() },
  { name: "list followed by paragraphs and heading", document: listDocument([
    block("First", 20, "list-item"), block("Para A", 50), block("Para B", 80), block("Section", 110, "heading"),
  ]) },
  { name: "consecutive list items", document: listDocument([
    block("First", 20, "list-item"), block("Second", 50, "list-item"), block("After the list", 80),
  ]) },
  { name: "columns", document: listDocument(columnBlocks) },
  { name: "OCR geometry", document: {
    loader: "ocr-fixture", form: "scanned" as const, text,
    pages: [{ pageNumber: 1, width: 600, height: 800, text, lines: [ocrLine] }],
  } },
  { name: "text with empty layout", document: {
    loader: "third-party", form: "digital" as const, text: "First line\nSecond line\n\nNext paragraph",
    pages: [{
      pageNumber: 1, width: 600, height: 800, text: "First line\nSecond line\n\nNext paragraph", blocks: [], lines: [],
    }],
  } },
];
let validator: ReturnType<typeof z.fromJSONSchema>;
beforeAll(async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../../../../apps/docs/public/schemas/docture-document-v2.schema.json", import.meta.url,
  ), "utf8").catch(() => "null"));
  validator = schema === null ? z.never() : z.fromJSONSchema(schema);
});

describe("JSON conversion fixtures", () => {
  it.each(fixtures)("validates $name in every asset mode", async ({ document }) => {
    for (const assets of modes) {
      const result = await new DocumentConverter().convert({ loaded: document }, { format: "json", assets });
      expect(result.mimeType).toBe("application/json");
      const parsed = JSON.parse(result.content);
      expect(validator.safeParse(parsed).success).toBe(true);
      expect(parseDoctureDocument(parsed).ok).toBe(true);
      expect(parsed.pages.map((page: { elements: unknown }) => page.elements)).toEqual(result.pages.map((page) => page.elements));
    }
  });

  it("validates the real rich PDF through both PDF loaders in every asset mode", async () => {
    const fixture = await makeRichDocumentPdf();
    for (const loader of [new DocumentLoaderPdfJs(), new DocumentLoaderMuPdf()]) {
      const converter = new DocumentConverter({ loaders: [loader] });
      for (const assets of modes) {
        const result = await converter.convert({ bytes: fixture.bytes, mimeType: "application/pdf" }, { format: "json", assets });
        expect(result.mimeType).toBe("application/json");
        expect(result.pages).toHaveLength(2);
        expect(validator.safeParse(JSON.parse(result.content)).success).toBe(true);
        expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
      }
    }
  });

  it("validates plain text and Markdown paragraphs with every supported separator", async () => {
    for (const mimeType of ["text/plain", "text/markdown"]) {
      for (const separator of ["\n\n", "\r\n\r\n", "\n \t\n", "\f"]) {
        const converter = new DocumentConverter({ loaders: [new DocumentLoaderData()] });
        const result = await converter.convert({
          bytes: new TextEncoder().encode("First paragraph" + separator + "Second paragraph"), mimeType,
        }, { format: "json" });
        expect(result.mimeType).toBe("application/json");
        expect(validator.safeParse(JSON.parse(result.content)).success).toBe(true);
        expect(parseDoctureDocument(JSON.parse(result.content)).ok).toBe(true);
      }
    }
  });
});
