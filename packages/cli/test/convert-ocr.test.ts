import { MissingEngineError, silentLogger, type DocumentLoader, type LoadedDocument } from "docture";
import { afterAll, describe, expect, it } from "vitest";
import { withRequiredOcrEngine } from "../src/wiring.js";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const pdf = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf" };
const ctx = () => ({ signal: new AbortController().signal, logger: silentLogger });
const capabilities = { text: true, geometry: false, images: false, mimeTypes: ["application/pdf"] } as const;

function document(loader: string, texts: readonly string[]): LoadedDocument {
  return {
    loader,
    form: "mixed",
    text: texts.join("\f"),
    pages: texts.map((text, index) => ({ pageNumber: index + 1, width: 612, height: 792, text })),
  };
}

function loader(name: string, load: DocumentLoader["load"]): DocumentLoader {
  return { name, capabilities, load };
}

describe("docture convert --ocr", () => {
  it("plans PDF.js wrapped in an OCR fallback for the chosen engine", async () => {
    const cwd = await tempDir("convert-ocr");
    await writeFixture(cwd, "scan.pdf", "%PDF-1.7 pretend");

    for (const engine of ["tesseract", "paddleocr"]) {
      const run = await cli(["convert", "scan.pdf", "-o", "out", "--ocr", engine, "--dry-run", "--format", "json", "--no-config"], { cwd });
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout).results[0].plan.loaders).toEqual([`pdfjs+ocr:${engine}`]);
    }
  });

  it("rejects an engine it does not offer", async () => {
    const cwd = await tempDir("convert-ocr-choice");
    const run = await cli(["convert", "scan.pdf", "-o", "out", "--ocr", "abbyy"], { cwd });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--ocr must be one of tesseract, paddleocr, got "abbyy".');
  });

  it("keeps configured loaders and says that --ocr was ignored", async () => {
    const cwd = await tempDir("convert-ocr-config");
    await writeFixture(cwd, "scan.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "docture.config.mjs", `export default {
  loaders: [{ name: "configured", capabilities: { text: true, geometry: false, images: false, mimeTypes: ["application/pdf"] }, async load() { throw new Error("not called"); } }],
};
`);
    const run = await cli(["convert", "scan.pdf", "-o", "out", "--ocr", "tesseract", "--dry-run", "--format", "json"], { cwd });

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).results[0].plan.loaders).toEqual(["configured"]);
    expect(run.stderr).toContain(
      "--ocr is ignored because the config supplies loaders. Wrap a loader with withOcrFallback in the config instead.",
    );
  });
});

describe("the --ocr loader composition", () => {
  it("rejects with the OCR engine's install hint when the engine is missing", async () => {
    const missing = new MissingEngineError("tesseract.js", "7.0.0", "docture/loaders/tesseract");
    const composed = withRequiredOcrEngine(
      loader("pdfjs", async () => document("pdfjs", [""])),
      loader("tesseract", async () => { throw missing; }),
    );

    await expect(composed.load(pdf, ctx())).rejects.toBe(missing);
  });

  it("returns OCR text for an empty page and PDF.js text for the rest", async () => {
    const composed = withRequiredOcrEngine(
      loader("pdfjs", async () => document("pdfjs", ["A digital page with plenty of text", ""])),
      loader("tesseract", async () => document("tesseract", ["", "Scanned page recovered by OCR"])),
    );
    const loaded = await composed.load(pdf, ctx());

    expect(composed.name).toBe("pdfjs+ocr:tesseract");
    expect(loaded.text).toBe("A digital page with plenty of text\fScanned page recovered by OCR");
  });

  it("does not report a missing engine for a later document that needs no OCR", async () => {
    const missing = new MissingEngineError("tesseract.js", "7.0.0", "docture/loaders/tesseract");
    const texts = [[""], ["A digital page with plenty of text"]];
    const composed = withRequiredOcrEngine(
      loader("pdfjs", async () => document("pdfjs", texts.shift() ?? [])),
      loader("tesseract", async () => { throw missing; }),
    );

    await expect(composed.load(pdf, ctx())).rejects.toBe(missing);
    expect((await composed.load(pdf, ctx())).text).toBe("A digital page with plenty of text");
  });
});
