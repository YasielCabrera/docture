/**
 * The loader conformance suite.
 *
 * This is what makes "swap `pdfjs-dist` for `mupdf`" a real promise rather than a
 * marketing one: every loader package runs THIS suite against its own class, so
 * two loaders are interchangeable because they were tested to be, not because they
 * happen to share an interface.
 *
 * Adding a loader for a new library means writing the adapter and adding one call:
 *
 * ```ts
 * describeLoaderConformance({ name: "MuPdfLoader", create: () => new MuPdfLoader() });
 * ```
 */

import { describe, expect, it } from "vitest";
import {
  loaderAccepts,
  silentLogger,
  type DocumentLoader,
  type LoadedDocument,
} from "../../core/index.js";
import { makeInvoicePdf } from "../fixtures/invoice.js";

export interface LoaderConformanceOptions {
  /** Display name for the suite. Use the class name. */
  readonly name: string;
  /** Fresh instance per test, so one test's disposal cannot affect another. */
  readonly create: () => DocumentLoader | Promise<DocumentLoader>;
  /**
   * Opt out of a check the library genuinely cannot satisfy — a text-only
   * extractor has no geometry, and that is a legitimate shape for a loader.
   * Defaults follow the loader's own declared `capabilities`.
   */
  readonly skip?: {
    readonly geometry?: boolean;
    readonly images?: boolean;
    readonly multiPage?: boolean;
    readonly scanned?: boolean;
  };
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47];
const JPEG_HEADER = [0xff, 0xd8, 0xff];

function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    PNG_HEADER.every((b, i) => bytes[i] === b) || JPEG_HEADER.every((b, i) => bytes[i] === b)
  );
}

export function describeLoaderConformance(options: LoaderConformanceOptions): void {
  const ctx = { signal: new AbortController().signal, logger: silentLogger };

  async function load(
    loader: DocumentLoader,
    pdf: { bytes: Uint8Array },
  ): Promise<LoadedDocument> {
    return loader.load({ bytes: pdf.bytes, mimeType: "application/pdf" }, ctx);
  }

  describe(`loader conformance: ${options.name}`, () => {
    it("declares itself honestly", async () => {
      const loader = await options.create();
      expect(loader.name).toBeTruthy();
      expect(loader.capabilities.mimeTypes.length).toBeGreaterThan(0);
      expect(loaderAccepts(loader, "application/pdf")).toBe(true);
    });

    it("reads a text-layer PDF and finds its content", async () => {
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 11 });

      const document = await load(loader, pdf);

      expect(document.pages.length).toBeGreaterThan(0);
      expect(document.loader).toBeTruthy();
      // The invoice number is the cheapest proof the text layer was really read.
      expect(document.text).toContain(pdf.expected.invoiceNumber);
      expect(document.text).toContain(pdf.expected.sellerName);
    });

    it("numbers pages from 1, in order, with real dimensions", async () => {
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 12 });

      const document = await load(loader, pdf);

      expect(document.pages.map((p) => p.pageNumber)).toEqual(
        document.pages.map((_p, i) => i + 1),
      );
      for (const page of document.pages) {
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
      }
    });

    it("keeps `text` consistent with the pages it came from", async () => {
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 13 });

      const document = await load(loader, pdf);

      // Whole-document text must not invent or lose content relative to the pages.
      // Verbatim containment, not a token sample: a page's text is a substring of
      // the document's, which also pins down that the join preserves line breaks.
      for (const page of document.pages) {
        if (page.text.length > 0) expect(document.text).toContain(page.text);
      }
    });

    it("reports a text PDF as digital", async () => {
      const loader = await options.create();
      if (!loader.capabilities.text) return;
      const pdf = await makeInvoicePdf({ seed: 14 });

      const document = await load(loader, pdf);
      expect(document.form).toBe("digital");
    });

    it("spans a long document across pages", async () => {
      if (options.skip?.multiPage === true) return;
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 15, lineItemCount: 45 });

      const document = await load(loader, pdf);

      expect(pdf.pageCount).toBeGreaterThan(1);
      expect(document.pages.length).toBe(pdf.pageCount);
    });

    it("handles a page with no text without throwing", async () => {
      if (options.skip?.scanned === true) return;
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 16, textless: true });

      // A loader may legitimately refuse a scan — but it must do so as a thrown
      // error the pipeline can fall back from, never as a bogus empty success.
      const document = await load(loader, pdf).catch(() => undefined);
      if (document === undefined) return;

      expect(document.text.trim().length).toBeLessThan(50);
      if (loader.capabilities.text) expect(document.form).toBe("scanned");
    });

    it("produces positioned geometry inside the page box", async () => {
      const loader = await options.create();
      if (!loader.capabilities.geometry || options.skip?.geometry === true) return;
      const pdf = await makeInvoicePdf({ seed: 17 });

      const document = await load(loader, pdf);
      const first = document.pages[0];
      expect(first).toBeDefined();
      expect(first?.lines?.length ?? 0).toBeGreaterThan(0);

      for (const page of document.pages) {
        for (const line of page.lines ?? []) {
          // Top-left origin: y grows downward and everything is on the page.
          expect(line.y).toBeGreaterThanOrEqual(-1);
          expect(line.y).toBeLessThanOrEqual(page.height + 1);
          expect(line.spans.length).toBeGreaterThan(0);

          const xs = line.spans.map((s) => s.x);
          expect([...xs]).toEqual([...xs].sort((a, b) => a - b)); // left to right
          for (const span of line.spans) {
            expect(span.x).toBeGreaterThanOrEqual(-1);
            expect(span.x).toBeLessThanOrEqual(page.width + 1);
            expect(span.width).toBeGreaterThanOrEqual(0);
          }
        }
        const ys = (page.lines ?? []).map((l) => l.y);
        expect([...ys]).toEqual([...ys].sort((a, b) => a - b)); // top to bottom
      }
    });

    it("puts the invoice number in a line, not just in the page blob", async () => {
      const loader = await options.create();
      if (!loader.capabilities.geometry || options.skip?.geometry === true) return;
      const pdf = await makeInvoicePdf({ seed: 18 });

      const document = await load(loader, pdf);
      const lines = document.pages.flatMap((p) => p.lines ?? []);
      expect(lines.some((l) => l.text.includes(pdf.expected.invoiceNumber))).toBe(true);
    });

    it("renders a page to an image on demand", async () => {
      const loader = await options.create();
      if (!loader.capabilities.images || options.skip?.images === true) return;
      const pdf = await makeInvoicePdf({ seed: 19 });

      const document = await load(loader, pdf);
      const first = document.pages[0];
      expect(first?.image).toBeDefined();

      const bytes = await first?.image?.({ dpi: 72 });
      expect(bytes).toBeDefined();
      expect(bytes!.length).toBeGreaterThan(100);
      expect(looksLikeImage(bytes!)).toBe(true);
    });

    it("rejects an already-aborted signal instead of doing the work", async () => {
      const loader = await options.create();
      const pdf = await makeInvoicePdf({ seed: 20 });
      const controller = new AbortController();
      controller.abort();

      await expect(
        loader.load(
          { bytes: pdf.bytes, mimeType: "application/pdf" },
          { signal: controller.signal, logger: silentLogger },
        ),
      ).rejects.toThrow();
    });

    it("rejects bytes that are not a document of its kind", async () => {
      const loader = await options.create();
      await expect(
        loader.load({ bytes: new Uint8Array([1, 2, 3, 4, 5]), mimeType: "application/pdf" }, ctx),
      ).rejects.toThrow();
    });

    it("can be disposed, twice, without complaint", async () => {
      const loader = await options.create();
      await loader.dispose?.();
      await loader.dispose?.();
    });
  });
}
