import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as pdfjs from "../../src/loaders/pdfjs/index.js";
import * as mupdf from "../../src/loaders/mupdf/index.js";
import * as tesseract from "../../src/loaders/tesseract/index.js";
import * as paddleocr from "../../src/loaders/paddleocr/index.js";

const entries = [
  { engine: "pdfjs", module: pdfjs, Constructor: pdfjs.DocumentLoaderPdfJs, name: "DocumentLoaderPdfJs", exports: ["DocumentLoaderPdfJs"] },
  { engine: "mupdf", module: mupdf, Constructor: mupdf.DocumentLoaderMuPdf, name: "DocumentLoaderMuPdf", exports: ["DocumentLoaderMuPdf", "MuPdfRasterizer", "muPdfRasterizer"] },
  { engine: "tesseract", module: tesseract, Constructor: tesseract.DocumentLoaderTesseract, name: "DocumentLoaderTesseract", exports: ["DocumentLoaderTesseract"] },
  { engine: "paddleocr", module: paddleocr, Constructor: paddleocr.DocumentLoaderPaddleOcr, name: "DocumentLoaderPaddleOcr", exports: ["DocumentLoaderPaddleOcr", "PADDLE_MODELS"] },
];

describe("loader naming", () => {
  it.each(entries)("exports one $engine loader whose class name matches its public name", ({ module, Constructor, name, exports }) => {
    expect(new Constructor().constructor.name).toBe(name);
    expect(Object.keys(module).sort()).toEqual(exports.sort());
  });

  it.each(entries)("exports one matching $engine options type", async ({ engine, name }) => {
    const source = await readFile(new URL("../../src/loaders/" + engine + "/index.ts", import.meta.url), "utf8");
    const names = [...source.matchAll(/export type\s*\{([^}]+)\}\s*from\s*["']\.\/loader\.js["']/g)]
      .flatMap((match) => (match[1] ?? "").split(",").map((part) => part.trim().split(/\s+as\s+/).at(-1)));
    expect(names).toEqual([name + "Options"]);
  });
});
