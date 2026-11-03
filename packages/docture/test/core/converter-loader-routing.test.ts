import { describe, expect, it } from "vitest";
import {
  DisposedError,
  DocumentConverter,
  MissingEngineError,
  NoConvertibleContentError,
  readDocument,
  silentLogger,
  withOcrFallback,
  type DocumentLoader,
  type LoadedDocument,
  type LoadedPage,
} from "../../src/core/index.js";
import { line, span } from "./conversion-fixtures.js";

const pdf = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "memo.pdf" };
const capabilities = { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] } as const;

function page(pageNumber: number, text: string): LoadedPage {
  return text === ""
    ? { pageNumber, width: 612, height: 792, text }
    : { pageNumber, width: 612, height: 792, text, lines: [line(40, [span(text, 20, 40)])] };
}

function document(loader: string, texts: readonly string[]): LoadedDocument {
  const pages = texts.map((text, index) => page(index + 1, text));
  return { pages, text: texts.join("\f"), form: "mixed", loader };
}

function countingLoader(name: string, read: () => LoadedDocument | Promise<LoadedDocument>) {
  const loader = {
    name,
    capabilities,
    loads: 0,
    async load() {
      loader.loads += 1;
      return read();
    },
  };
  return loader;
}

describe("a converter after dispose", () => {
  it("rejects every conversion with DISPOSED and never loads again", async () => {
    const loader = countingLoader("text-layer", () => document("text-layer", ["Memo body"]));
    const converter = new DocumentConverter({ loaders: [loader] });
    await converter.convert(pdf);
    await converter.dispose();

    const rejected = converter.convert(pdf);
    await expect(rejected).rejects.toBeInstanceOf(DisposedError);
    await expect(rejected).rejects.toMatchObject({
      code: "DISPOSED",
      message: "This DocumentConverter was disposed. Create a new DocumentConverter to convert more documents.",
    });
    const safe = await converter.safeConvert(pdf);
    expect(safe.ok ? undefined : safe.error).toBeInstanceOf(DisposedError);
    await expect(converter.convertBatch([pdf]).next()).rejects.toBeInstanceOf(DisposedError);
    expect(loader.loads).toBe(1);
  });

  it("stops an in-flight conversion before it starts the next loader", async () => {
    let started!: () => void;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const textLayer = countingLoader("text-layer", async () => {
      started();
      await gate;
      return document("text-layer", [""]);
    });
    const ocr = countingLoader("ocr", () => document("ocr", ["Recovered memo text"]));
    const converter = new DocumentConverter({ loaders: [textLayer, ocr] });

    const pending = converter.convert(pdf);
    await loading;
    const disposed = converter.dispose();
    release();

    await expect(pending).rejects.toBeInstanceOf(DisposedError);
    await disposed;
    expect([textLayer.loads, ocr.loads]).toEqual([1, 0]);
  });
});

describe("converter loader routing", () => {
  it("reads a scan with an OCR loader listed after the text-layer loader", async () => {
    const textLayer = countingLoader("text-layer", () => document("text-layer", ["", ""]));
    const ocr = countingLoader("ocr", () => document("ocr", ["Recovered memo text", "Second scanned page"]));
    const result = await new DocumentConverter({ loaders: [textLayer, ocr] }).convert(pdf, { format: "text" });

    expect(result.loader).toBe("ocr");
    expect(result.content).toBe("Recovered memo text\fSecond scanned page");
    expect(result.attempts.map(({ stage, strategy, status, errorCode }) => ({ stage, strategy, status, errorCode }))).toEqual([
      { stage: "load", strategy: "text-layer", status: "skipped", errorCode: "NO_CONVERTIBLE_CONTENT" },
      { stage: "load", strategy: "ocr", status: "ok", errorCode: undefined },
    ]);
  });

  it("keeps the text-layer loader when the selected pages have text", async () => {
    const textLayer = countingLoader("text-layer", () => document("text-layer", ["", "Digital second page"]));
    const ocr = countingLoader("ocr", () => document("ocr", ["Recovered", "Recovered"]));
    const result = await new DocumentConverter({ loaders: [textLayer, ocr] }).convert(pdf, { format: "text", pages: [2] });

    expect(result.loader).toBe("text-layer");
    expect(result.content).toBe("Digital second page");
    expect(ocr.loads).toBe(0);
  });

  it("names withOcrFallback when no loader recovers text", async () => {
    const textLayer = countingLoader("text-layer", () => document("text-layer", [""]));
    const ocr = countingLoader("ocr", () => document("ocr", ["  "]));
    const rejected = new DocumentConverter({ loaders: [textLayer, ocr] }).convert(pdf);

    await expect(rejected).rejects.toBeInstanceOf(NoConvertibleContentError);
    await expect(rejected).rejects.toThrow(
      "The loader recovered no convertible text (textLength=0, form=mixed). " +
        "For a scan, list an OCR loader after the text-layer loader. " +
        "To OCR only the empty pages of a mixed document, wrap the text-layer loader with withOcrFallback(primary, ocr).",
    );
    expect([textLayer.loads, ocr.loads]).toEqual([1, 1]);
  });

  it("reports a missing OCR engine rather than empty content", async () => {
    const textLayer = countingLoader("text-layer", () => document("text-layer", [""]));
    const missing = new MissingEngineError("tesseract.js", "7.0.0", "docture/loaders/tesseract");
    const ocr: DocumentLoader = { name: "ocr", capabilities, load: async () => { throw missing; } };

    await expect(new DocumentConverter({ loaders: [textLayer, ocr] }).convert(pdf)).rejects.toBe(missing);
  });

  it("leaves readDocument routing on the first loader that does not throw", async () => {
    const textLayer = countingLoader("text-layer", () => document("text-layer", [""]));
    const ocr = countingLoader("ocr", () => document("ocr", ["Recovered memo text"]));
    const read = await readDocument([textLayer, ocr], pdf, silentLogger, new AbortController().signal, undefined);

    expect(read.loader.name).toBe("text-layer");
    expect(ocr.loads).toBe(0);
  });
});

describe("OCR fallback diagnostics on a conversion", () => {
  it("reports which pages went to OCR and which loader supplied each page", async () => {
    const primary = countingLoader("pdfjs", () => document("pdfjs", ["A digital page with plenty of text", ""]));
    const ocr: DocumentLoader = { name: "tesseract", capabilities, load: async () => document("tesseract", ["", "Scanned page recovered by OCR"]) };
    const converter = new DocumentConverter({ loaders: [withOcrFallback(primary, ocr)] });
    const result = await converter.convert(pdf, { format: "json" });

    expect(result.loader).toBe("pdfjs+ocr:tesseract");
    expect(result.ocrFallback).toMatchObject({
      primary: "pdfjs",
      ocr: "tesseract",
      requestedPages: [2],
      pages: [
        { pageNumber: 1, supplier: "primary", originalQuality: 34 },
        { pageNumber: 2, supplier: "ocr", originalQuality: 0, candidateQuality: 29 },
      ],
      warnings: [],
      externalCost: "not-reported",
    });
    expect(Object.keys(JSON.parse(result.content) as object).sort()).toEqual(
      ["assets", "loader", "method", "pages", "schemaVersion", "warnings"],
    );
  });

  it("omits the diagnostics when the loader is not an OCR fallback", async () => {
    const plain = countingLoader("pdfjs", () => document("pdfjs", ["A digital page with plenty of text"]));
    const result = await new DocumentConverter({ loaders: [plain] }).convert(pdf);

    expect(result.loader).toBe("pdfjs");
    expect("ocrFallback" in result).toBe(false);
  });
});
