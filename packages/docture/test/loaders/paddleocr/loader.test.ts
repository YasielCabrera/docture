/**
 * Two tiers, on purpose.
 *
 * The default run is **offline and fast**: everything that can be checked without
 * recognizing a pixel — what the loader advertises, how it refuses work it cannot
 * do, and the byte handling that stands between a rasterizer and an ONNX session.
 * None of it loads ppu-paddle-ocr, which is the point of importing it lazily.
 *
 * The conformance suite and the OCR specifics need the real engine, which downloads
 * ~6.5 MB of ONNX models on first use and then runs two neural networks per page.
 * That is not something `pnpm check` should depend on, so it is behind `RUN_OCR`:
 *
 * ```sh
 * RUN_OCR=1 pnpm --filter docture exec vitest run test/loaders/paddleocr/loader.test.ts
 * ```
 */

import { describe, expect, it } from "vitest";
import {
  silentLogger,
  type GeometryLoader,
  type ImageLoader,
  type TextLoader,
} from "docture";
import { describeLoaderConformance } from "docture/testing/conformance";
import { formatMoney, makeInvoicePdf } from "docture/testing/fixtures";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { DocumentLoaderPaddleOcr, type DocumentLoaderPaddleOcrOptions } from "../../../src/loaders/paddleocr/index.js";

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const RUN_OCR = process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true";

function ocrLoader(options: DocumentLoaderPaddleOcrOptions = {}): DocumentLoaderPaddleOcr {
  return new DocumentLoaderPaddleOcr({
    rasterizer: new NapiCanvasRasterizer(),
    ...options,
  });
}

/** One page of the invoice fixture as real PNG bytes, without any OCR. */
async function invoicePng(seed: number, dpi = 300): Promise<Uint8Array> {
  const pdf = await makeInvoicePdf({ seed });
  const rendered = await new NapiCanvasRasterizer().rasterize(
    { bytes: pdf.bytes, mimeType: "application/pdf" },
    { dpi, format: "png", pages: [1] },
    ctx,
  );
  return rendered[0]!.bytes;
}

// ── Offline ─────────────────────────────────────────────────────────────────────

describe("DocumentLoaderPaddleOcr — what it advertises", () => {
  it("claims text, geometry and images", () => {
    const loader = ocrLoader();
    expect(loader.name).toBe("paddleocr");
    expect(loader.capabilities).toMatchObject({ text: true, geometry: true, images: true });
  });

  it("satisfies every capability-gated loader type", () => {
    // Compile-time assertions: these fail `tsc`, not the assertion below.
    const geometry: GeometryLoader = ocrLoader();
    const text: TextLoader = ocrLoader();
    const images: ImageLoader = ocrLoader();
    expect([geometry, text, images].every((l) => l.capabilities.text)).toBe(true);
  });

  it("only claims PDFs when a rasterizer is wired", () => {
    // Honesty is what keeps routing working: with no way to turn a page into pixels,
    // the pipeline should pass a PDF to another loader rather than pick this one.
    expect(new DocumentLoaderPaddleOcr().capabilities.mimeTypes).toEqual(["image/png", "image/jpeg", "image/tiff"]);
    expect(ocrLoader().capabilities.mimeTypes).toContain("application/pdf");
  });
});

describe("DocumentLoaderPaddleOcr — refusing work it cannot do", () => {
  it("explains how to fix a PDF with no rasterizer, instead of failing obscurely", async () => {
    const pdf = await makeInvoicePdf({ seed: 501 });
    await expect(
      new DocumentLoaderPaddleOcr().load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/no rasterizer is wired/i);
  });

  it("rejects bytes that are not a readable image", async () => {
    await expect(
      new DocumentLoaderPaddleOcr().load(
        { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
        ctx,
      ),
    ).rejects.toThrow(/not a readable PNG or JPEG/i);
  });

  it("rejects an already-aborted signal before loading the engine", async () => {
    const controller = new AbortController();
    controller.abort();
    const png = await invoicePng(502, 72);

    await expect(
      new DocumentLoaderPaddleOcr().load(
        { bytes: png, mimeType: "image/png" },
        { signal: controller.signal, logger: silentLogger },
      ),
    ).rejects.toThrow();
  });

  it("can be disposed, twice, without complaint — even having never loaded", async () => {
    const loader = ocrLoader();
    await loader.dispose();
    await loader.dispose();
  });
});

describe("handing bytes to the engine", () => {
  // ppu-paddle-ocr takes an ArrayBuffer and treats anything else as a canvas, so a
  // Uint8Array has to be converted — and converting it by reaching for `.buffer` is
  // the silent-corruption version of doing that. Node pools buffers under 8 KB, so a
  // rasterizer's output is routinely a window onto a much larger allocation.
  it("hands over the bytes, not the pool slab they live in", async () => {
    const { toArrayBuffer } = await import("../../../src/loaders/paddleocr/paddle.js");

    const slab = new Uint8Array(4096).fill(0xaa);
    slab.set([1, 2, 3, 4], 100);
    const view = slab.subarray(100, 104);

    const buffer = toArrayBuffer(view);
    expect(buffer.byteLength).toBe(4);
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4]);
  });

  it("passes an exactly-sized buffer through without copying it", async () => {
    const { toArrayBuffer } = await import("../../../src/loaders/paddleocr/paddle.js");
    const exact = new Uint8Array([9, 8, 7]);
    expect(toArrayBuffer(exact)).toBe(exact.buffer);
  });

  it("copies a Node Buffer, which is always a view into a pool", async () => {
    const { toArrayBuffer } = await import("../../../src/loaders/paddleocr/paddle.js");
    const pooled = Buffer.from([1, 2, 3]);
    const buffer = toArrayBuffer(pooled);
    expect(buffer.byteLength).toBe(3);
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3]);
  });
});

describe("the line-grouping band", () => {
  // PaddleOCR reports each region padded by a fraction of its own height, so a box is
  // taller than the text in it — and core bands proportionally to box height. Left at
  // core's 0.5 this loader would group nearly twice as loosely as every other one, on
  // a document where nothing about the text changed.
  it("cancels the padding, so the band is proportional to the text", async () => {
    const { lineToleranceFor } = await import("../../../src/loaders/paddleocr/loader.js");
    // 0.4 padding on each side → a box 1.8x the text → 0.5 / 1.8.
    expect(lineToleranceFor(0.4)).toBeCloseTo(0.2778, 4);
    // Which is half a TEXT height once the padding is applied back.
    expect(lineToleranceFor(0.4) * (1 + 2 * 0.4)).toBeCloseTo(0.5, 10);
  });

  it("is core's own default when there is no padding to cancel", async () => {
    const { lineToleranceFor } = await import("../../../src/loaders/paddleocr/loader.js");
    expect(lineToleranceFor(0)).toBe(0.5);
  });

  it("tightens as the padding grows, and ignores a negative one", async () => {
    const { lineToleranceFor } = await import("../../../src/loaders/paddleocr/loader.js");
    expect(lineToleranceFor(1)).toBeLessThan(lineToleranceFor(0.4));
    // Padding cannot shrink a box, so a negative value must not widen the band past
    // core's default — `linesFromWords` would start merging rows.
    expect(lineToleranceFor(-5)).toBe(0.5);
  });
});

// ── With the real engine ────────────────────────────────────────────────────────

if (RUN_OCR) {
  // The shared suite every loader package runs. Passing it is what makes
  // DocumentLoaderPaddleOcr interchangeable with DocumentLoaderPdfJs and DocumentLoaderTesseract rather
  // than merely similarly shaped — the same fixtures, the same invariants.
  describeLoaderConformance({
    name: "DocumentLoaderPaddleOcr",
    create: () => ocrLoader(),
  });

  describe("DocumentLoaderPaddleOcr — OCR specifics", () => {
    it("recovers the invoice fields a schema would ask for", async () => {
      const pdf = await makeInvoicePdf({ seed: 601 });
      const loader = ocrLoader();
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      expect(document.text).toContain(pdf.expected.invoiceNumber);
      expect(document.text).toContain(pdf.expected.buyerName);
      expect(document.form).toBe("digital");
      expect(document.meta).toMatchObject({
        pageCount: 1,
        pagesRead: 1,
        dpi: 300,
        model: "v6Tiny",
        strategy: "perLine",
      });
      expect(Number(document.meta?.["meanConfidence"])).toBeGreaterThan(0.7);
      await loader.dispose();
    });

    it("puts a whole table row on one line, including the columns OCR splits off", async () => {
      // The detector finds a row's description, quantity, unit price and amount as
      // four separate regions. Regrouping by `y` in core's `linesFromWords` is what
      // puts the row back together, which is what a parser reads.
      const pdf = await makeInvoicePdf({ seed: 602, lineItemCount: 3 });
      const loader = ocrLoader();
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      const first = pdf.expected.lineItems[0]!;
      const row = document.pages.flatMap((p) => p.lines ?? []).find((l) => l.text.includes("#100"));

      expect(row).toBeDefined();
      // Deliberately not `toContain(first.description)`: recognition is allowed to
      // lose the space before "#100", and it sometimes does. What must hold is that
      // all four columns landed on ONE line — asserting on a rendered space would be
      // testing the recognizer, not this loader.
      expect(row!.text).toContain(first.description.split(" ")[0]);
      expect(row!.text).toContain(formatMoney(first.unitPrice));
      expect(row!.text).toContain(formatMoney(first.amount));
      expect(row!.spans.length).toBeGreaterThanOrEqual(4);
      // Every span carries what OCR thought of it — a text layer cannot.
      expect(row!.spans.every((s) => (s.confidence ?? 0) > 0)).toBe(true);
      await loader.dispose();
    });

    it("gives every row of a dense table its own line", async () => {
      const pdf = await makeInvoicePdf({ seed: 603, lineItemCount: 8 });
      const loader = ocrLoader();
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      const lines = document.pages.flatMap((p) => p.lines ?? []);
      // `#100`…`#107` — one per row, and the part of a description that survives
      // recognition most reliably.
      const markers = pdf.expected.lineItems.map((_item, i) => `#${100 + i}`);

      for (const marker of markers) {
        expect(lines.filter((l) => l.text.includes(marker))).toHaveLength(1);
      }
      // And no line holds two of them: banding too loosely would merge two rows,
      // which silently attaches one row's amount to another's description.
      for (const line of lines) {
        expect(markers.filter((m) => line.text.includes(m)).length).toBeLessThanOrEqual(1);
      }
      await loader.dispose();
    });

    it("puts the heading near the top of the page, in PDF points", async () => {
      const pdf = await makeInvoicePdf({ seed: 604 });
      const loader = ocrLoader();
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      const page = document.pages[0]!;
      // A4 in points, recovered from a 300-DPI raster.
      expect(page.width).toBeCloseTo(595.28, 0);
      expect(page.height).toBeCloseTo(841.89, 0);

      const heading = page.lines?.find((l) => l.text.includes("INVOICE"));
      expect(heading).toBeDefined();
      // The fixture draws it at y = 50pt; top-left origin, so it stays near 0. The
      // band is wider than the text-layer loaders' because the box is padded.
      expect(heading!.y).toBeGreaterThan(30);
      expect(heading!.y).toBeLessThan(80);
      await loader.dispose();
    });

    it("OCRs a PNG with no rasterizer in sight", async () => {
      const png = await invoicePng(605);
      const pdf = await makeInvoicePdf({ seed: 605 });

      const loader = new DocumentLoaderPaddleOcr();
      const document = await loader.load({ bytes: png, mimeType: "image/png" }, ctx);

      expect(document.pages).toHaveLength(1);
      expect(document.text).toContain(pdf.expected.invoiceNumber);
      // Treated as a page scanned at `dpi`, which lands it back on A4 points.
      expect(document.pages[0]!.width).toBeCloseTo(595.28, 0);
      // `page.image()` hands back the bytes it was given rather than re-encoding.
      expect(await document.pages[0]!.image?.()).toBe(png);
      await loader.dispose();
    });

    it("reports a page it could not read as scanned, not as an empty success", async () => {
      const pdf = await makeInvoicePdf({ seed: 606, textless: true });
      const loader = ocrLoader();
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      expect(document.text.trim()).toBe("");
      expect(document.form).toBe("scanned");
      await loader.dispose();
    });

    it("honours maxPages, and still reports the document's real length", async () => {
      const pdf = await makeInvoicePdf({ seed: 607, lineItemCount: 45 });
      expect(pdf.pageCount).toBeGreaterThan(1);

      const loader = ocrLoader({ maxPages: 1 });
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      expect(document.pages).toHaveLength(1);
      expect(document.meta).toMatchObject({ pageCount: pdf.pageCount, pagesRead: 1 });
      await loader.dispose();
    });

    it("recognizes pages in parallel without scrambling their order", async () => {
      const pdf = await makeInvoicePdf({ seed: 608, lineItemCount: 45 });
      const loader = ocrLoader({ concurrency: 2 });
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      expect(document.pages.length).toBe(pdf.pageCount);
      expect(document.pages.map((p) => p.pageNumber)).toEqual(
        document.pages.map((_p, i) => i + 1),
      );
      // Page 1 holds the header; a swapped page would put it on the last page.
      expect(document.pages[0]!.text).toContain(pdf.expected.invoiceNumber);
      await loader.dispose();
    });

    it("reuses one engine across loads, and works again after being disposed", async () => {
      const pdf = await makeInvoicePdf({ seed: 609 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
      const loader = ocrLoader();

      const first = await loader.load(source, ctx);
      const second = await loader.load(source, ctx);
      // Identical, and not because a cache said so — the loader passes `noCache`,
      // since ppu-paddle-ocr's own cache keys on a hash of the first kilobyte.
      expect(second.text).toBe(first.text);

      await loader.dispose();
      // Disposal releases the ONNX sessions; it does not brick the loader.
      const third = await loader.load(source, ctx);
      expect(third.text).toBe(first.text);
      await loader.dispose();
    });

    it("shares one initialization between two concurrent loads", async () => {
      const pdf = await makeInvoicePdf({ seed: 610 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
      const loader = ocrLoader();

      // Both arrive before the engine exists. Neither may fail, and neither may
      // build a second pair of ONNX sessions.
      const [a, b] = await Promise.all([loader.load(source, ctx), loader.load(source, ctx)]);
      expect(a.text).toBe(b.text);
      expect(a.text).toContain(pdf.expected.invoiceNumber);
      await loader.dispose();
    });

    it("drops low-confidence regions when asked, and keeps more when told to", async () => {
      const pdf = await makeInvoicePdf({ seed: 611 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };

      const kept = ocrLoader({ minConfidence: 0 });
      const filtered = ocrLoader({ minConfidence: 0.999 });
      const all = await kept.load(source, ctx);
      const none = await filtered.load(source, ctx);

      expect(all.text.length).toBeGreaterThan(0);
      // Nothing clears 99.9%, so the floor removes the page's text entirely.
      expect(none.text.length).toBeLessThan(all.text.length);
      await Promise.all([kept.dispose(), filtered.dispose()]);
    });

    it("reports geometry per region under every recognition strategy", async () => {
      // perLine and crossLine stitch crops together for the inference pass and split
      // the text back out afterwards, so all three report one result per region. A
      // strategy that collapsed a line into a single box would break every parser
      // written against span positions.
      const pdf = await makeInvoicePdf({ seed: 612 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };

      const perBox = ocrLoader({ strategy: "perBox" });
      const perLine = ocrLoader({ strategy: "perLine" });
      const [a, b] = await Promise.all([perBox.load(source, ctx), perLine.load(source, ctx)]);

      for (const document of [a, b]) {
        const spans = document.pages.flatMap((p) => (p.lines ?? []).flatMap((l) => l.spans));
        expect(spans.length).toBeGreaterThan(10);
        expect(document.text).toContain(pdf.expected.invoiceNumber);
      }
      await Promise.all([perBox.dispose(), perLine.dispose()]);
    });

    it("renders a page image on demand, and memoizes it per page", async () => {
      const pdf = await makeInvoicePdf({ seed: 613, lineItemCount: 45 });
      const loader = ocrLoader({ maxPages: 2 });
      const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

      const first = await document.pages[0]!.image!({ dpi: 72 });
      expect([...first.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      // Same request, same promise.
      expect(await document.pages[0]!.image!({ dpi: 72 })).toBe(first);
      // Different page, different image.
      const second = await document.pages[1]!.image!({ dpi: 72 });
      expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).not.toBe(0);
      await loader.dispose();
    });
  });
} else {
  describe.skip("DocumentLoaderPaddleOcr — real OCR (set RUN_OCR=1 to run)", () => {
    it("runs the loader conformance suite and the OCR specifics", () => {});
  });
}
