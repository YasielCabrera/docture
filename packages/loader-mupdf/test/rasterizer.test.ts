import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { silentLogger, withRasterizer } from "@docture/core";
import { describeRasterizerConformance, makeInvoicePdf } from "@docture/testing";
import { MuPdfLoader, MuPdfRasterizer } from "../src/index.js";

describeRasterizerConformance({
  name: "MuPdfRasterizer",
  create: () => new MuPdfRasterizer(),
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };

/**
 * The first pixel of a PNG, without a decoder.
 *
 * Only row 0's first pixel is needed, and that one is stored literally under every PNG
 * filter type — Sub, Up and Paeth all reference neighbours that are zero there. So:
 * check IHDR really is 8-bit truecolour and non-interlaced (so a future format change
 * fails loudly rather than being misread), inflate the IDAT, skip the filter byte, and
 * the next three bytes are the pixel.
 */
function firstPixel(png: Uint8Array): [number, number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idat: Uint8Array[] = [];
  let offset = 8; // past the 8-byte signature
  let checked = false;

  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      expect(body[8]).toBe(8); // bit depth
      expect(body[9]).toBe(2); // colour type 2 = truecolour RGB, no alpha
      expect(body[12]).toBe(0); // interlace: none
      checked = true;
    }
    if (type === "IDAT") idat.push(body);
    if (type === "IEND") break;
    offset += 12 + length; // length + type + body + crc
  }

  expect(checked).toBe(true);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  return [raw[1]!, raw[2]!, raw[3]!];
}

describe("MuPdfRasterizer — specifics", () => {
  it("renders at the requested DPI", async () => {
    const pdf = await makeInvoicePdf({ seed: 401 });
    const pages = await new MuPdfRasterizer().rasterize(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      { dpi: 150, pages: [1] },
      ctx,
    );

    // A4 is 595.28 x 841.89 pt; at 150 DPI that is ~1240 x ~1754 px.
    expect(pages[0]?.widthPx).toBeGreaterThan(1230);
    expect(pages[0]?.widthPx).toBeLessThan(1250);
  });

  it("reports `scale` as points-per-pixel, and it survives a maxEdge downscale", async () => {
    const pdf = await makeInvoicePdf({ seed: 402 });
    const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new MuPdfRasterizer();

    const plain = await rasterizer.rasterize(source, { dpi: 144, pages: [1] }, ctx);
    expect(plain[0]!.scale).toBeCloseTo(72 / 144, 2);

    const capped = await rasterizer.rasterize(source, { dpi: 600, maxEdge: 500, pages: [1] }, ctx);
    const page = capped[0]!;
    expect(Math.max(page.widthPx, page.heightPx)).toBeLessThanOrEqual(500);
    // scale x widthPx must still reconstruct the page width in points.
    expect(page.scale * page.widthPx).toBeCloseTo(595.28, 0);
  });

  it("caps the long edge exactly, for caps that divide awkwardly", async () => {
    // MuPDF rounds a page's pixel box outward, so a cap is only honoured because the
    // scale aims just under it. These are the sizes where an off-by-one would show.
    const pdf = await makeInvoicePdf({ seed: 403 });
    const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new MuPdfRasterizer();

    for (const maxEdge of [333, 400, 512, 1000, 1999]) {
      const pages = await rasterizer.rasterize(source, { dpi: 600, maxEdge, pages: [1] }, ctx);
      const page = pages[0]!;
      expect(Math.max(page.widthPx, page.heightPx)).toBeLessThanOrEqual(maxEdge);
      // And not needlessly small — within a pixel of the cap.
      expect(Math.max(page.widthPx, page.heightPx)).toBeGreaterThanOrEqual(maxEdge - 1);
    }
  });

  it("emits JPEG when asked, and it is smaller than the PNG", async () => {
    const pdf = await makeInvoicePdf({ seed: 404 });
    const source = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new MuPdfRasterizer();

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

  it("renders onto a WHITE background", async () => {
    // The `alpha: false` argument to `toPixmap` is what does this. With alpha the page
    // comes back transparent-black: JPEG cannot carry it, and a vision model reads the
    // result as an inverted page — a silent, total loss of accuracy.
    const pdf = await makeInvoicePdf({ seed: 405 });
    const pages = await new MuPdfRasterizer().rasterize(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      { dpi: 36, pages: [1] },
      ctx,
    );

    expect(firstPixel(pages[0]!.bytes)).toEqual([255, 255, 255]);
  });

  it("rejects a page number the document does not have", async () => {
    const pdf = await makeInvoicePdf({ seed: 406 });
    await expect(
      new MuPdfRasterizer().rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { pages: [99] },
        ctx,
      ),
    ).rejects.toThrow(/out of range/i);
  });

  it("fails with a useful message on bytes that are not a PDF", async () => {
    await expect(
      new MuPdfRasterizer().rasterize(
        { bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" },
        { dpi: 72 },
        ctx,
      ),
    ).rejects.toThrow(/mupdf could not open/i);
  });

  it("does not consume the caller's buffer", async () => {
    const pdf = await makeInvoicePdf({ seed: 407 });
    const raw = { bytes: pdf.bytes, mimeType: "application/pdf" };
    const rasterizer = new MuPdfRasterizer();

    await rasterizer.rasterize(raw, { dpi: 36, pages: [1] }, ctx);
    const second = await rasterizer.rasterize(raw, { dpi: 36, pages: [1] }, ctx);
    expect(second[0]!.bytes.length).toBeGreaterThan(100);
  });
});

describe("MuPdfLoader + MuPdfRasterizer — one dependency, still two plugins", () => {
  it("composes into a loader that reads AND renders, and the type says so", async () => {
    const loader = withRasterizer(new MuPdfLoader(), new MuPdfRasterizer({ dpi: 100 }));

    expect(loader.capabilities.images).toBe(true);
    expect(new MuPdfLoader().capabilities.images).toBe(false);
    // Both halves are MuPDF, and the composed id names both — reader first, renderer
    // second, exactly as `pdfjs+napi-canvas` does.
    expect(loader.name).toBe("mupdf+mupdf");

    const pdf = await makeInvoicePdf({ seed: 408 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

    expect(document.text).toContain(pdf.expected.invoiceNumber);
    const bytes = await document.pages[0]?.image?.();
    expect(bytes).toBeDefined();
    expect([...bytes!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("gives each page its own image", async () => {
    const loader = withRasterizer(new MuPdfLoader(), new MuPdfRasterizer({ dpi: 60 }));
    const pdf = await makeInvoicePdf({ seed: 409, lineItemCount: 45 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);
    expect(document.pages.length).toBeGreaterThan(1);

    const first = await document.pages[0]!.image!();
    const second = await document.pages[1]!.image!();
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).not.toBe(0);
  });

  it("lets a FOREIGN rasterizer render what MuPdfLoader read", async () => {
    // The point of keeping them separate plugins: MuPdfLoader is not wedded to MuPDF's
    // renderer. A rasterizer from any library — here a fake standing in for one — drops
    // straight in, and nothing about the loader changes.
    let renders = 0;
    const foreign = {
      name: "foreign",
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

    const loader = withRasterizer(new MuPdfLoader(), foreign);
    const pdf = await makeInvoicePdf({ seed: 410, lineItemCount: 45 });
    const document = await loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);

    expect(loader.name).toBe("mupdf+foreign");
    // Lazy by construction: a multi-page load costs zero renders.
    expect(renders).toBe(0);

    await document.pages[0]?.image?.({ dpi: 150 });
    await document.pages[0]?.image?.({ dpi: 150 });
    expect(renders).toBe(1);
  });
});
