/**
 * Two tiers, on purpose.
 *
 * The default run is **offline and fast**: everything that can be checked without
 * recognizing a pixel — what the loader advertises, how it refuses work it cannot
 * do, and the header reader that sizes an image page.
 *
 * The conformance suite and the OCR specifics need the real engine, which downloads
 * a ~5 MB language model from a CDN on first use. That is not something `pnpm check`
 * should depend on, so it is behind `RUN_OCR`:
 *
 * ```sh
 * RUN_OCR=1 pnpm --filter docture exec vitest run test/loaders/tesseract/loader.test.ts
 * ```
 */

import { describe, expect, it } from "vitest";
import {
  imageSize,
  silentLogger,
  type GeometryLoader,
  type ImageLoader,
  type TextLoader,
} from "docture";
import { describeLoaderConformance } from "docture/testing/conformance";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { DocumentLoaderTesseract, type DocumentLoaderTesseractOptions } from "../../../src/loaders/tesseract/index.js";

const ctx = { signal: new AbortController().signal, logger: silentLogger };
const RUN_OCR = process.env["RUN_OCR"] === "1" || process.env["RUN_OCR"] === "true";

function ocrLoader(options: DocumentLoaderTesseractOptions = {}): DocumentLoaderTesseract {
  return new DocumentLoaderTesseract({
    rasterizer: new NapiCanvasRasterizer(),
    ...options,
  });
}

/** One page of the invoice fixture as real PNG bytes, without any OCR. */
async function invoicePng(seed: number, dpi = 150): Promise<Uint8Array> {
  const pdf = await makeInvoicePdf({ seed });
  const rendered = await new NapiCanvasRasterizer().rasterize(
    { bytes: pdf.bytes, mimeType: "application/pdf" },
    { dpi, format: "png", pages: [1] },
    ctx,
  );
  return rendered[0]!.bytes;
}

// ── Offline ─────────────────────────────────────────────────────────────────────

describe("DocumentLoaderTesseract — what it advertises", () => {
  it("claims text, geometry and images", () => {
    const loader = ocrLoader();
    expect(loader.name).toBe("tesseract");
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
    expect(new DocumentLoaderTesseract().capabilities.mimeTypes).toEqual(["image/png", "image/jpeg", "image/tiff"]);
    expect(ocrLoader().capabilities.mimeTypes).toContain("application/pdf");
  });
});

describe("DocumentLoaderTesseract — refusing work it cannot do", () => {
  it("explains how to fix a PDF with no rasterizer, instead of failing obscurely", async () => {
    const pdf = await makeInvoicePdf({ seed: 301 });
    await expect(
      new DocumentLoaderTesseract().load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/no rasterizer is wired/i);
  });

  it("rejects bytes that are not a readable image", async () => {
    await expect(
      new DocumentLoaderTesseract().load({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, ctx),
    ).rejects.toThrow(/not a readable PNG or JPEG/i);
  });

  it("rejects an already-aborted signal before spawning anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const png = await invoicePng(302);

    await expect(
      new DocumentLoaderTesseract().load(
      { bytes: png, mimeType: "image/png" },
      { signal: controller.signal, logger: silentLogger },
      ),
    ).rejects.toThrow();
  });

  it("refuses an empty language list", async () => {
    const png = await invoicePng(303);
    await expect(
      new DocumentLoaderTesseract({ languages: [] }).load({ bytes: png, mimeType: "image/png" }, ctx),
    ).rejects.toThrow(/languages/i);
  });

  it("can be disposed, twice, without complaint — even having never loaded", async () => {
    const loader = ocrLoader();
    await loader.dispose();
    await loader.dispose();
  });
});

describe("sizing an image page from its header", () => {
  // An image carries no page size, so `page.width`/`page.height` come from the pixel
  // dimensions in the header. Wrong here means every OCR box is wrong.
  //
  // `imageSize` itself lives in core and is tested there against hand-built headers.
  // What is worth asserting HERE is that it agrees with real rasterizer output —
  // the bytes this loader is actually handed.
  it("reads a PNG's dimensions", async () => {
    const png = await invoicePng(304, 150);
    // A4 at 150 DPI: 595.28 x 841.89 pt, floored to whole pixels.
    expect(imageSize(png)).toEqual({ widthPx: 1240, heightPx: 1753 });
  });

  it("reads a JPEG's dimensions, past its metadata segments", async () => {
    const pdf = await makeInvoicePdf({ seed: 305 });
    const rendered = await new NapiCanvasRasterizer().rasterize(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      { dpi: 72, format: "jpeg", quality: 0.8, pages: [1] },
      ctx,
    );
    expect(imageSize(rendered[0]!.bytes)).toEqual({ widthPx: 595, heightPx: 841 });
  });

  it("declines to size a PDF, which is why this loader refuses one without a rasterizer", async () => {
    const pdf = await makeInvoicePdf({ seed: 306 });
    expect(imageSize(pdf.bytes)).toBeUndefined();
  });
});

// ── With the real engine ────────────────────────────────────────────────────────

if (RUN_OCR) {
  // The shared suite every loader package runs. Passing it is what makes
  // DocumentLoaderTesseract interchangeable with DocumentLoaderPdfJs rather than merely
  // similarly shaped — the same fixtures, the same invariants.
  describeLoaderConformance({
    name: "DocumentLoaderTesseract",
    create: () => ocrLoader(),
  });

  describe("DocumentLoaderTesseract — OCR specifics", () => {
    it("recovers the invoice fields a schema would ask for", async () => {
      const pdf = await makeInvoicePdf({ seed: 401 });
      const loader = ocrLoader();
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      expect(document.text).toContain(pdf.expected.invoiceNumber);
      expect(document.text).toContain(pdf.expected.issuedAt);
      expect(document.text).toContain(pdf.expected.buyerName);
      expect(document.form).toBe("digital");
      expect(document.meta).toMatchObject({ pageCount: 1, pagesRead: 1, dpi: 300 });
      expect(Number(document.meta?.["meanConfidence"])).toBeGreaterThan(0.8);
      await loader.dispose();
    });

    it("puts a whole table row on one line, including the column OCR splits off", async () => {
      // Tesseract's own layout analysis routinely puts the right-hand Amount column
      // in a separate block, which would divorce a row's total from its description.
      // Regrouping by `y` in core's `linesFromWords` is what puts the row back.
      const pdf = await makeInvoicePdf({ seed: 402, lineItemCount: 3 });
      const loader = ocrLoader();
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      const first = pdf.expected.lineItems[0]!;
      const row = document.pages
        .flatMap((p) => p.lines ?? [])
        .find((l) => l.text.includes(first.description));

      expect(row).toBeDefined();
      expect(row!.text).toContain(String(first.quantity));
      expect(row!.spans.length).toBeGreaterThan(3);
      // Every span carries what OCR thought of it — a text layer cannot.
      expect(row!.spans.every((s) => (s.confidence ?? 0) > 0)).toBe(true);
      await loader.dispose();
    });

    it("defaults to full layout analysis, which `singleBlock` would lose the heading to", async () => {
      // tesseract.js initialises Tesseract at --psm 6, where layout analysis finds
      // one block and drops the 20pt "INVOICE" heading entirely. This loader sets
      // --psm 3 instead; the contrast is the reason why.
      const pdf = await makeInvoicePdf({ seed: 403 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };

      const auto = ocrLoader();
      const single = ocrLoader({ pageSegmentation: "singleBlock" });
      const withAuto = await auto.load(source, ctx);
      const withSingleBlock = await single.load(source, ctx);

      expect(withAuto.text).toContain("INVOICE");
      expect(withSingleBlock.text).not.toContain("INVOICE");
      await Promise.all([auto.dispose(), single.dispose()]);
    });

    it("puts the heading near the top of the page, in PDF points", async () => {
      const pdf = await makeInvoicePdf({ seed: 404 });
      const loader = ocrLoader();
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      const page = document.pages[0]!;
      // A4 in points, recovered from a 300-DPI raster.
      expect(page.width).toBeCloseTo(595.28, 0);
      expect(page.height).toBeCloseTo(841.89, 0);

      const heading = page.lines?.find((l) => l.text.includes("INVOICE"));
      expect(heading).toBeDefined();
      // The fixture draws it at y = 50pt; top-left origin, so it stays near 0.
      expect(heading!.y).toBeGreaterThan(40);
      expect(heading!.y).toBeLessThan(70);
      await loader.dispose();
    });

    it("OCRs a PNG with no rasterizer in sight", async () => {
      const pdf = await makeInvoicePdf({ seed: 405 });
      const png = (
        await new NapiCanvasRasterizer().rasterize(
          { bytes: pdf.bytes, mimeType: "application/pdf" },
          { dpi: 300, format: "png", pages: [1] },
          ctx,
        )
      )[0]!.bytes;

      const loader = new DocumentLoaderTesseract();
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
      const pdf = await makeInvoicePdf({ seed: 406, textless: true });
      const loader = ocrLoader();
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      expect(document.text.trim()).toBe("");
      expect(document.form).toBe("scanned");
      await loader.dispose();
    });

    it("honours maxPages without claiming the capped count is the document's length", async () => {
      const pdf = await makeInvoicePdf({ seed: 407, lineItemCount: 45 });
      expect(pdf.pageCount).toBeGreaterThan(1);

      const loader = ocrLoader({ maxPages: 1 });
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      expect(document.pages).toHaveLength(1);
      expect(document.meta).toMatchObject({ pagesRead: 1 });
      expect(document.meta).not.toHaveProperty("pageCount");
      await loader.dispose();
    });

    it("recognizes pages in parallel without scrambling their order", async () => {
      const pdf = await makeInvoicePdf({ seed: 408, lineItemCount: 45 });
      const loader = ocrLoader({ concurrency: 2 });
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

      expect(document.pages.length).toBe(pdf.pageCount);
      expect(document.pages.map((p) => p.pageNumber)).toEqual(
        document.pages.map((_p, i) => i + 1),
      );
      // Page 1 holds the header; a swapped page would put it on the last page.
      expect(document.pages[0]!.text).toContain(pdf.expected.invoiceNumber);
      await loader.dispose();
    });

    it("reuses one worker across loads, and works again after being disposed", async () => {
      const pdf = await makeInvoicePdf({ seed: 409 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
      const loader = ocrLoader();

      const first = await loader.load(source, ctx);
      const second = await loader.load(source, ctx);
      expect(second.text).toBe(first.text);

      await loader.dispose();
      // Disposal releases the engine; it does not brick the loader.
      const third = await loader.load(source, ctx);
      expect(third.text).toBe(first.text);
      await loader.dispose();
    });

    it("drops low-confidence words when asked, and keeps everything by default", async () => {
      const pdf = await makeInvoicePdf({ seed: 410 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };

      const kept = ocrLoader();
      const filtered = ocrLoader({ minConfidence: 0.999 });
      const all = await kept.load(source, ctx);
      const none = await filtered.load(source, ctx);

      expect(all.text.length).toBeGreaterThan(0);
      // Nothing clears 99.9%, so the floor removes the page's text entirely.
      expect(none.text.length).toBeLessThan(all.text.length);
      await Promise.all([kept.dispose(), filtered.dispose()]);
    });

    it("renders a page image on demand, and memoizes it per page", async () => {
      const pdf = await makeInvoicePdf({ seed: 411, lineItemCount: 45 });
      const loader = ocrLoader();
      const document = await loader.load(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        ctx,
      );

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
  describe.skip("DocumentLoaderTesseract — real OCR (set RUN_OCR=1 to run)", () => {
    it("runs the loader conformance suite and the OCR specifics", () => {});
  });
}
