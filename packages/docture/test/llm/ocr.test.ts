import { describe, expect, it } from "vitest";
import {
  createDocumentConverter,
  silentLogger,
  withOcrFallback,
  type LoadedDocument,
  type Rasterizer,
} from "docture";
import { llmOcr, type LlmOcrElement } from "docture/llm/ocr";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockOcrModel } from "docture/testing/llm";
import { mockModel } from "./mock-model.js";

const pdf = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: "application/pdf", fileName: "scan.pdf" };

function fakeRasterizer(pageCount: number): Rasterizer & { readonly requests: (readonly number[] | undefined)[] } {
  const requests: (readonly number[] | undefined)[] = [];
  return {
    name: "fake-raster",
    formats: ["png"],
    requests,
    async rasterize(_document, options) {
      requests.push(options.pages);
      const pages = options.pages ?? Array.from({ length: pageCount }, (_, index) => index + 1);
      return pages.map((pageNumber) => ({
        pageNumber,
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageNumber]),
        widthPx: 595,
        heightPx: 842,
        format: "png" as const,
        scale: 1,
      }));
    },
  };
}

const scan: Readonly<Record<number, readonly LlmOcrElement[]>> = {
  1: [
    { kind: "page-header", text: "ACME quarterly report" },
    { kind: "heading", level: 1, text: "Results" },
    { kind: "paragraph", text: "Revenue grew in every region." },
    { kind: "list", ordered: true, items: [{ marker: "1.", text: "North" }, { marker: "2.", text: "South" }] },
  ],
  2: [
    { kind: "heading", level: 2, text: "Totals" },
    { kind: "table", headerRows: 1, rows: [["Region", "Revenue"], ["North", "12"], ["South"]] },
    { kind: "list", ordered: false, items: [{ marker: "•", text: "Audited" }] },
    { kind: "code", text: "total = north + south\nprint(total)" },
    { kind: "page-footer", text: "2" },
  ],
};

describe("llmOcr", () => {
  it("converts model-read page images to Markdown", async () => {
    const converter = createDocumentConverter({
      loaders: [llmOcr({ model: mockOcrModel(scan), rasterizer: fakeRasterizer(2) })],
    });

    const result = await converter.convert(pdf);

    expect(result.loader).toBe("llm-ocr");
    expect(result.content).toBe([
      "<!-- page: 1 -->",
      "# Results",
      "Revenue grew in every region.",
      "1. North\n2. South",
      "<!-- page: 2 -->",
      "## Totals",
      "| Region | Revenue |\n| --- | --- |\n| North | 12 |\n| South |  |",
      "- Audited",
      "```\ntotal = north + south\nprint(total)\n```",
    ].join("\n\n"));
  });

  it("keeps the printed list markers and running headers in plain text", async () => {
    const model = mockOcrModel({
      1: [
        { kind: "page-header", text: "ACME quarterly report" },
        { kind: "list", ordered: true, items: [{ marker: "a)", text: "North" }, { marker: "b)", text: "South" }] },
      ],
    });
    const converter = createDocumentConverter({ loaders: [llmOcr({ model, rasterizer: fakeRasterizer(2) })] });

    const result = await converter.convert(pdf, { format: "text", pages: [1] });

    expect(result.content).toBe("ACME quarterly report\n\na) North\nb) South");
  });

  it("renders and reads only the requested pages", async () => {
    const rasterizer = fakeRasterizer(3);
    const { model, calls } = mockModel([{ elements: [{ kind: "paragraph", text: "Only page two" }] }]);
    const loaded = await llmOcr({ model, rasterizer }).load(pdf, {
      signal: new AbortController().signal,
      logger: silentLogger,
      request: { pages: [2] },
    });

    expect(rasterizer.requests).toEqual([[2]]);
    expect(calls).toHaveLength(1);
    expect(loaded.pages.map((page) => [page.pageNumber, page.text])).toEqual([[2, "Only page two"]]);
    expect(loaded.meta?.["usage"]).toMatchObject({ inputTokens: 100, outputTokens: 25 });
  });

  it("replaces only the pages the primary loader could not read when used for OCR fallback", async () => {
    const primary: LoadedDocument = loadedDocument(["Digital page with a real text layer.", ""]);
    const loader = withOcrFallback(
      inMemoryLoader(primary),
      llmOcr({ model: mockOcrModel({ 2: [{ kind: "paragraph", text: "Scanned page read by the model." }] }), rasterizer: fakeRasterizer(2) }),
      { threshold: 10, assess: (page) => ({ kind: "text", quality: page.text.trim().length }) },
    );

    const result = await createDocumentConverter({ loaders: [loader] }).convert(pdf);

    expect(result.content).toBe([
      "<!-- page: 1 -->",
      "Digital page with a real text layer.",
      "<!-- page: 2 -->",
      "Scanned page read by the model.",
    ].join("\n\n"));
  });

  it("fails the load with a typed error naming the page whose answer does not fit the layout schema", async () => {
    const { model } = mockModel([{ elements: [{ kind: "table", headerRows: 3, rows: [["only row"]] }] }]);
    const loader = llmOcr({ model, rasterizer: fakeRasterizer(1), maxRetries: 0 });

    const error = await createDocumentConverter({ loaders: [loader] }).convert(pdf).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "LOAD_FAILED" });
    expect((error as { attempts: unknown }).attempts).toMatchObject([{
      stage: "load",
      strategy: "llm-ocr",
      status: "failed",
      errorCode: "MODEL_OUTPUT_FAILED",
      error: "Page 1: No object generated: response did not match schema.",
      issues: [{ path: "elements.0.headerRows", message: "headerRows exceeds the number of rows" }],
      usage: { inputTokens: 100, outputTokens: 25 },
    }]);
  });

  it("keeps the original page with an OCR_FAILED warning when the model's page answer is malformed", async () => {
    const { model } = mockModel([{ elements: [{ kind: "caption", text: "not a supported kind" }] }]);
    const loader = withOcrFallback(
      inMemoryLoader(loadedDocument(["Digital page with a real text layer.", "x"])),
      llmOcr({ model, rasterizer: fakeRasterizer(2), maxRetries: 0 }),
      { threshold: 10, assess: (page) => ({ kind: "text", quality: page.text.trim().length }) },
    );

    const loaded = await loader.load(pdf, { signal: new AbortController().signal, logger: silentLogger });

    expect(loaded.pages.map((page) => page.text)).toEqual(["Digital page with a real text layer.", "x"]);
    expect((loaded.meta?.["ocrFallback"] as { warnings: unknown }).warnings).toEqual([{
      pageNumber: 2,
      code: "OCR_FAILED",
      message: "OCR failed for this page; original page retained.",
      errorCode: "MODEL_OUTPUT_FAILED",
    }]);
  });

  it("keeps at most the configured number of page requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const answers = mockOcrModel({});
    const model = {
      ...answers,
      async doGenerate(options: Parameters<typeof answers.doGenerate>[0]) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return answers.doGenerate(options);
      },
    };

    const loaded = await llmOcr({ model, rasterizer: fakeRasterizer(5), concurrency: 2 })
      .load(pdf, { signal: new AbortController().signal, logger: silentLogger });

    expect(loaded.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("sends no page to the model once the caller aborts", async () => {
    const controller = new AbortController();
    const rasterizer = fakeRasterizer(2);
    const aborting: Rasterizer = {
      ...rasterizer,
      async rasterize(document, options, ctx) {
        const pages = await rasterizer.rasterize(document, options, ctx);
        controller.abort(new Error("caller stopped"));
        return pages;
      },
    };
    const { model, calls } = mockModel([{ elements: [] }]);

    await expect(llmOcr({ model, rasterizer: aborting }).load(pdf, { signal: controller.signal, logger: silentLogger }))
      .rejects.toThrow("caller stopped");
    expect(calls).toHaveLength(0);
  });

  it("rejects a concurrency that is not a positive integer", () => {
    expect(() => llmOcr({ model: mockOcrModel({}), rasterizer: fakeRasterizer(1), concurrency: 0 }))
      .toThrow(expect.objectContaining({ code: "INVALID_OPTION", message: "concurrency must be a positive integer; received 0." }));
  });
});
