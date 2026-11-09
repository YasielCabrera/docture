import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExtractor,
  defineClassification,
  isDoctureError,
  mapWithConcurrency,
  pageWindows,
  Process,
  SplittingStrategy,
  withOcrFallback,
} from "docture";
import { chunkDocument } from "docture/chunk";
import { expandEmail } from "docture/inputs/email";
import { llm, textSplitter, vision } from "docture/llm";
import { llmOcr } from "docture/llm/ocr";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "../llm/mock-model.js";

const Value = z.object({ value: z.string() });
const bytes = new Uint8Array([1]);
const loader = () => inMemoryLoader(loadedDocument(["Invoice total 60.00 with a complete text layer."]));
const rasterizer = { name: "raster", formats: ["png"] as const, rasterize: async () => [] };

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function invalid(error: unknown) {
  expect(isDoctureError(error, "INVALID_OPTION")).toBe(true);
  return isDoctureError(error, "INVALID_OPTION")
    ? { option: error.option, message: error.message, hint: error.hint }
    : undefined;
}

describe("option validation raises INVALID_OPTION", () => {
  it("names the option, the accepted values and the received value", () => {
    expect(invalid(caught(() => createExtractor({ loaders: [loader()], maxRepairs: -1 })))).toEqual({
      option: "maxRepairs",
      message: "maxRepairs must be a non-negative integer; received -1.",
      hint: "Set maxRepairs to a non-negative integer.",
    });
    expect(invalid(caught(() => createExtractor({ loaders: [loader()], onRuleFailure: "typo" as never })))).toEqual({
      option: "onRuleFailure",
      message: 'onRuleFailure must be "report" or "fail"; received "typo".',
      hint: 'Set onRuleFailure to "report" or "fail".',
    });
  });

  it("serializes the option in toJSON", () => {
    const error = caught(() => createExtractor({ loaders: [loader()], maxRepairs: 1.5 }));
    expect(isDoctureError(error) ? error.toJSON() : undefined).toEqual({
      code: "INVALID_OPTION",
      name: "InvalidOptionError",
      option: "maxRepairs",
      expected: "a non-negative integer",
      received: 1.5,
      message: "maxRepairs must be a non-negative integer; received 1.5.",
      hint: "Set maxRepairs to a non-negative integer.",
    });
  });

  it("rejects per-call extraction options before any document is read", async () => {
    const extractor = createExtractor({ loaders: [loader()], strategies: [fixedStrategy("f", { value: "x" })] });
    expect(invalid(await extractor.extract(bytes, Value, { maxRepairs: Number.NaN }).catch((error: unknown) => error)))
      .toMatchObject({ option: "maxRepairs", message: "maxRepairs must be a non-negative integer; received NaN." });
    const batch = extractor.extractBatch([bytes], Value, { concurrency: 0 });
    expect(invalid(await batch.next().catch((error: unknown) => error)))
      .toMatchObject({ option: "concurrency", message: "concurrency must be a positive integer; received 0." });
  });

  it("rejects a Process concurrency", async () => {
    const invoice = defineClassification({ name: "invoice", description: "an invoice", schema: Value });
    const run = new Process()
      .loadExtractor(createExtractor({ loaders: [loader()] }))
      .loadFile(bytes)
      .split([invoice], SplittingStrategy.EAGER)
      .extract({ concurrency: 2.5 });
    expect(invalid(await run.catch((error: unknown) => error)))
      .toMatchObject({ option: "concurrency", message: "concurrency must be a positive integer; received 2.5." });
  });

  it("rejects core helper arguments", async () => {
    expect(invalid(caught(() => pageWindows([1, 2, 3], 1))))
      .toMatchObject({ option: "size", message: "size must be an integer of at least 2; received 1." });
    expect(invalid(await mapWithConcurrency([1], 0, async (item) => item).catch((error: unknown) => error)))
      .toMatchObject({ option: "concurrency" });
    expect(invalid(caught(() => withOcrFallback(loader(), loader(), { threshold: -1 }))))
      .toMatchObject({ option: "threshold", message: "threshold must be a finite non-negative number; received -1." });
    expect(invalid(caught(() => withOcrFallback(loader(), loader(), { minimumImprovement: Number.POSITIVE_INFINITY }))))
      .toMatchObject({ option: "minimumImprovement" });
  });

  it("rejects chunking budgets", () => {
    const document = { pages: [] } as unknown as Parameters<typeof chunkDocument>[0];
    expect(invalid(caught(() => chunkDocument(document, { budget: { unit: "characters", max: 0 } }))))
      .toMatchObject({ option: "budget.max", message: "budget.max must be a finite positive number; received 0." });
    expect(invalid(caught(() => chunkDocument(document, { budget: { unit: "words" as never, max: 10 } }))))
      .toMatchObject({ option: "budget.unit", message: 'budget.unit must be "characters" or "estimatedTokens"; received "words".' });
    expect(invalid(caught(() => chunkDocument(document, { budget: { unit: "characters", max: 10 }, overlapElements: -1 }))))
      .toMatchObject({ option: "overlapElements", message: "overlapElements must be a non-negative integer; received -1." });
  });

  it("rejects model component options at construction", () => {
    const { model } = mockModel([]);
    expect(invalid(caught(() => llm({ model, concurrency: 0 })))).toMatchObject({ option: "concurrency" });
    expect(invalid(caught(() => vision({ model, pagesPerRequest: 0 })))).toMatchObject({ option: "pagesPerRequest" });
    expect(invalid(caught(() => vision({ model, concurrency: -2 })))).toMatchObject({ option: "concurrency" });
    expect(invalid(caught(() => llmOcr({ model, rasterizer, concurrency: 0 })))).toMatchObject({ option: "concurrency" });
  });

  it("rejects a text splitter's eager page limit", async () => {
    const splitter = textSplitter({ model: mockModel([]).model, maxEagerPages: 0 });
    const ctx = { classifications: [], signal: new AbortController().signal, logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } }, recordUsage() {} };
    expect(invalid(await splitter.splitEager?.([], ctx).catch((error: unknown) => error)))
      .toMatchObject({ option: "maxEagerPages", message: "maxEagerPages must be a positive integer; received 0." });
  });

  it("rejects a rasterizer pixel budget when the rasterizer is built", () => {
    expect(invalid(caught(() => new NapiCanvasRasterizer({ maxPixels: 0 }))))
      .toMatchObject({ option: "maxPixels", message: "maxPixels must be a number of at least 1, or Infinity; received 0." });
    expect(invalid(caught(() => new MuPdfRasterizer({ maxPixels: -5 })))).toMatchObject({ option: "maxPixels" });
  });

  it("rejects empty Tesseract languages when the loader is built", () => {
    expect(invalid(caught(() => new DocumentLoaderTesseract({ languages: [] })))).toEqual({
      option: "languages",
      message: 'languages must be a non-empty list of Tesseract language codes, such as ["eng"]; received an array.',
      hint: 'Set languages to a non-empty list of Tesseract language codes, such as ["eng"].',
    });
  });

  it("rejects an email limit that is not a safe integer", async () => {
    const raw = { bytes: new TextEncoder().encode("Subject: x\r\n\r\nbody"), mimeType: "message/rfc822" };
    expect(invalid(await expandEmail(raw, { maxParts: 0 }).catch((error: unknown) => error)))
      .toMatchObject({ option: "maxParts", message: "maxParts must be a safe integer of at least 1; received 0." });
  });
});
