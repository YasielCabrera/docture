/**
 * The rasterizer conformance suite — the same interchangeability guarantee, for
 * the plugin type that renders pages.
 */

import { describe, expect, it } from "vitest";
import { silentLogger, type Rasterizer } from "../../core/index.js";
import { makeInvoicePdf } from "../fixtures/invoice.js";

export interface RasterizerConformanceOptions {
  readonly name: string;
  readonly create: () => Rasterizer | Promise<Rasterizer>;
}

function looksLikePng(bytes: Uint8Array): boolean {
  return [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
}

export function describeRasterizerConformance(options: RasterizerConformanceOptions): void {
  const ctx = { signal: new AbortController().signal, logger: silentLogger };

  describe(`rasterizer conformance: ${options.name}`, () => {
    it("declares at least one output format", async () => {
      const rasterizer = await options.create();
      expect(rasterizer.name).toBeTruthy();
      expect(rasterizer.formats.length).toBeGreaterThan(0);
    });

    it("renders every page, numbered from 1", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 31, lineItemCount: 45 });

      const pages = await rasterizer.rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { dpi: 72 },
        ctx,
      );

      expect(pages.length).toBe(pdf.pageCount);
      expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_p, i) => i + 1));
      for (const page of pages) {
        expect(page.widthPx).toBeGreaterThan(0);
        expect(page.heightPx).toBeGreaterThan(0);
        expect(page.bytes.length).toBeGreaterThan(100);
        expect(page.scale).toBeGreaterThan(0);
      }
    });

    it("renders only the pages asked for", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 32, lineItemCount: 45 });

      const pages = await rasterizer.rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { dpi: 72, pages: [2] },
        ctx,
      );

      expect(pages).toHaveLength(1);
      expect(pages[0]?.pageNumber).toBe(2);
    });

    it("scales with DPI", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 33 });
      const source = { bytes: pdf.bytes, mimeType: "application/pdf" };

      const low = await rasterizer.rasterize(source, { dpi: 72, pages: [1] }, ctx);
      const high = await rasterizer.rasterize(source, { dpi: 144, pages: [1] }, ctx);

      expect(high[0]!.widthPx).toBeGreaterThan(low[0]!.widthPx * 1.5);
    });

    it("honours maxEdge by downscaling", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 34 });

      const pages = await rasterizer.rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { dpi: 300, maxEdge: 400, pages: [1] },
        ctx,
      );

      const page = pages[0]!;
      expect(Math.max(page.widthPx, page.heightPx)).toBeLessThanOrEqual(400);
    });

    it("emits the format it reports", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 35 });

      const pages = await rasterizer.rasterize(
        { bytes: pdf.bytes, mimeType: "application/pdf" },
        { dpi: 72, format: "png", pages: [1] },
        ctx,
      );

      expect(pages[0]?.format).toBe("png");
      expect(looksLikePng(pages[0]!.bytes)).toBe(true);
    });

    it("rejects an already-aborted signal", async () => {
      const rasterizer = await options.create();
      const pdf = await makeInvoicePdf({ seed: 36 });
      const controller = new AbortController();
      controller.abort();

      await expect(
        rasterizer.rasterize(
          { bytes: pdf.bytes, mimeType: "application/pdf" },
          { dpi: 72 },
          { signal: controller.signal, logger: silentLogger },
        ),
      ).rejects.toThrow();
    });

    it("can be disposed, twice", async () => {
      const rasterizer = await options.create();
      await rasterizer.dispose?.();
      await rasterizer.dispose?.();
    });
  });
}
