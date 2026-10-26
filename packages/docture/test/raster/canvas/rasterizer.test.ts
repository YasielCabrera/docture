import { describe, expect, it } from "vitest";
import { silentLogger, withRasterizer } from "docture";
import { describeRasterizerConformance } from "docture/testing/conformance";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "../../../src/raster/canvas/index.js";

describeRasterizerConformance({
  name: "NapiCanvasRasterizer",
  create: () => new NapiCanvasRasterizer(),
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };

describe("NapiCanvasRasterizer — specifics", () => {
  it("renders at the requested DPI", async () => {
    const pdf = await makeInvoicePdf({ seed: 201 });
    const pages = await new NapiCanvasRasterizer().rasterize(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      { dpi: 150, pages: [1] },
      ctx,
    );

    // A4 is 595.28 x 841.89 pt; at 150 DPI that is ~1240 x ~1754 px.
    expect(pages[0]?.widthPx).toBeGreaterThan(1230);
    expect(pages[0]?.widthPx).toBeLessThan(1250);
  });

  it("reports `scale` as points-per-pixel, and it survives a maxEdge downscale", async () => {
    const pdf = await makeInvoicePdf({ seed: 202 });
    const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new NapiCanvasRasterizer();

    const plain = await rasterizer.rasterize(source, { dpi: 144, pages: [1] }, ctx);
    expect(plain[0]!.scale).toBeCloseTo(72 / 144, 2);

    const capped = await rasterizer.rasterize(source, { dpi: 600, maxEdge: 500, pages: [1] }, ctx);
    const page = capped[0]!;
    expect(Math.max(page.widthPx, page.heightPx)).toBeLessThanOrEqual(500);
    // scale x widthPx must still reconstruct the page width in points.
    expect(page.scale * page.widthPx).toBeCloseTo(595.28, 0);
  });

  it("emits JPEG when asked, and it is smaller than the PNG", async () => {
    const pdf = await makeInvoicePdf({ seed: 203 });
    const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new NapiCanvasRasterizer();

    const png = await rasterizer.rasterize(source, { dpi: 150, format: "png", pages: [1] }, ctx);
    const jpeg = await rasterizer.rasterize(
      source,
      { dpi: 150, format: "jpeg", quality: 0.7, pages: [1] },
      ctx,
    );

    expect(jpeg[0]?.format).toBe("jpeg");
    expect([...jpeg[0]!.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpeg[0]!.bytes.length).toBeLessThan(png[0]!.bytes.length);
  });

  it("rejects a page number the document does not have", async () => {
    const pdf = await makeInvoicePdf({ seed: 204 });
    await expect(
      new NapiCanvasRasterizer().rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { pages: [99] },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PAGE_OUT_OF_RANGE", missingPages: [99], pageCount: 1 });
  });
});

describe("withRasterizer — composing a reader with a renderer", () => {
  it("turns a text-only loader into one that can also render, and says so in the type", async () => {
    const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 100 }));

    // The composition advertises rendering; the bare DocumentLoaderPdfJs does not.
    expect(loader.capabilities.images).toBe(true);
    expect(new DocumentLoaderPdfJs().capabilities.images).toBe(false);
    expect(loader.name).toBe("pdfjs+napi-canvas");

    const pdf = await makeInvoicePdf({ seed: 205 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

    // Text still works…
    expect(document.text).toContain(pdf.expected.invoiceNumber);
    // …and now every page can produce an image.
    const bytes = await document.pages[0]?.image?.();
    expect(bytes).toBeDefined();
    expect([...bytes!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("memoizes a page image, so asking twice renders once", async () => {
    let renders = 0;
    const counting = {
      name: "counting",
      formats: ["png"] as const,
      async rasterize() {
        renders += 1;
        return [
          {
            pageNumber: 1,
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            widthPx: 10,
            heightPx: 10,
            format: "png" as const,
            scale: 1,
          },
        ];
      },
    };

    const loader = withRasterizer(new DocumentLoaderPdfJs(), counting);
    const pdf = await makeInvoicePdf({ seed: 206 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

    await document.pages[0]?.image?.({ dpi: 150 });
    await document.pages[0]?.image?.({ dpi: 150 });
    expect(renders).toBe(1);

    // A different request is a different render.
    await document.pages[0]?.image?.({ dpi: 300 });
    expect(renders).toBe(2);
  });

  it("gives each page ITS OWN image", async () => {
    // Regression: the memoization key omitted the page number, so every page
    // returned page 1's render — silently, and identically.
    const loader = withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer({ dpi: 60 }));
    const pdf = await makeInvoicePdf({ seed: 208, lineItemCount: 45 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);
    expect(document.pages.length).toBeGreaterThan(1);

    const first = await document.pages[0]!.image!();
    const second = await document.pages[1]!.image!();

    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).not.toBe(0);
  });

  it("renders nothing for a document nobody looks at", async () => {
    let renders = 0;
    const counting = {
      name: "counting",
      formats: ["png"] as const,
      async rasterize() {
        renders += 1;
        return [];
      },
    };

    const loader = withRasterizer(new DocumentLoaderPdfJs(), counting);
    const pdf = await makeInvoicePdf({ seed: 207, lineItemCount: 45 });
    await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

    // Lazy by construction: a multi-page load costs zero renders.
    expect(renders).toBe(0);
  });
});
