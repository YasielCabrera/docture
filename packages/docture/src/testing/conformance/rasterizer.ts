/**
 * The rasterizer conformance suite — the same interchangeability guarantee, for
 * the plugin type that renders pages.
 */

import { describe, expect, it } from "vitest";
import { silentLogger, type RasterFormat, type Rasterizer } from "../../core/index.js";
import { pdfFixtures, type ConformanceFixtures } from "./fixtures.js";

export interface RasterizerConformanceOptions {
  readonly name: string;
  readonly create: () => Rasterizer | Promise<Rasterizer>;
  /** The documents to render. Default {@link pdfFixtures}. Without `multiPage`, page-count checks are skipped. */
  readonly fixtures?: ConformanceFixtures;
  /** The output format to check, one the rasterizer advertises. Default `"png"`. */
  readonly format?: RasterFormat;
}

const SIGNATURES: Readonly<Record<RasterFormat, readonly number[]>> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};

export function describeRasterizerConformance(options: RasterizerConformanceOptions): void {
  const fixtures = options.fixtures ?? pdfFixtures;
  const format = options.format ?? "png";
  const ctx = { signal: new AbortController().signal, logger: silentLogger };

  describe(`rasterizer conformance: ${options.name}`, () => {
    it("declares at least one output format", async () => {
      const rasterizer = await options.create();
      expect(rasterizer.name).toBeTruthy();
      expect(rasterizer.formats.length).toBeGreaterThan(0);
    });

    it("renders every page, numbered from 1", async (test) => {
      if (fixtures.multiPage === undefined) test.skip();
      const rasterizer = await options.create();
      const document = await fixtures.multiPage!(31);

      const pages = await rasterizer.rasterize(document, { dpi: 72 }, ctx);

      expect(pages.length).toBe(document.pageCount);
      expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_p, i) => i + 1));
      for (const page of pages) {
        expect(page.widthPx).toBeGreaterThan(0);
        expect(page.heightPx).toBeGreaterThan(0);
        expect(page.bytes.length).toBeGreaterThan(100);
        expect(page.scale).toBeGreaterThan(0);
      }
    });

    it("renders only the pages asked for", async (test) => {
      if (fixtures.multiPage === undefined) test.skip();
      const rasterizer = await options.create();
      const document = await fixtures.multiPage!(32);

      const pages = await rasterizer.rasterize(document, { dpi: 72, pages: [2] }, ctx);

      expect(pages).toHaveLength(1);
      expect(pages[0]?.pageNumber).toBe(2);
    });

    it("scales with DPI", async () => {
      const rasterizer = await options.create();
      const document = await fixtures.document(33);

      const low = await rasterizer.rasterize(document, { dpi: 72, pages: [1] }, ctx);
      const high = await rasterizer.rasterize(document, { dpi: 144, pages: [1] }, ctx);

      expect(high[0]!.widthPx).toBeGreaterThan(low[0]!.widthPx * 1.5);
    });

    it("honours maxEdge by downscaling", async () => {
      const rasterizer = await options.create();
      const document = await fixtures.document(34);

      const pages = await rasterizer.rasterize(document, { dpi: 300, maxEdge: 400, pages: [1] }, ctx);

      const page = pages[0]!;
      expect(Math.max(page.widthPx, page.heightPx)).toBeLessThanOrEqual(400);
    });

    it("emits the format it reports", async () => {
      const rasterizer = await options.create();
      expect(rasterizer.formats).toContain(format);
      const document = await fixtures.document(35);

      const pages = await rasterizer.rasterize(document, { dpi: 72, format, pages: [1] }, ctx);

      expect(pages[0]?.format).toBe(format);
      expect([...pages[0]!.bytes.subarray(0, SIGNATURES[format].length)]).toEqual(SIGNATURES[format]);
    });

    it("rejects an already-aborted signal", async () => {
      const rasterizer = await options.create();
      const document = await fixtures.document(36);
      const controller = new AbortController();
      controller.abort();

      await expect(
        rasterizer.rasterize(document, { dpi: 72 }, { signal: controller.signal, logger: silentLogger }),
      ).rejects.toThrow();
    });

    it("can be disposed, twice", async () => {
      const rasterizer = await options.create();
      await rasterizer.dispose?.();
      await rasterizer.dispose?.();
    });
  });
}
