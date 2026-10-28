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
 * describeLoaderConformance({ name: "DocumentLoaderMuPdf", create: () => new DocumentLoaderMuPdf() });
 * ```
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  loaderAccepts,
  silentLogger,
  type DocumentLoader,
  type LoadedDocument,
} from "../../core/index.js";
import { pdfFixtures, type ConformanceDocument, type ConformanceFixtures } from "./fixtures.js";

export interface LoaderConformanceOptions {
  /** Display name for the suite. Use the class name. */
  readonly name: string;
  /** Fresh instance per test, so one test's disposal cannot affect another. */
  readonly create: () => DocumentLoader | Promise<DocumentLoader>;
  /**
   * The documents to load. Default {@link pdfFixtures}. Checks a profile has no
   * document for, and checks a loader's capabilities rule out, are reported as skipped.
   */
  readonly fixtures?: ConformanceFixtures;
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
  const fixtures = options.fixtures ?? pdfFixtures;
  const ctx = { signal: new AbortController().signal, logger: silentLogger };
  const owned = new Set<DocumentLoader>();
  async function create(): Promise<DocumentLoader> {
    const loader = await options.create();
    owned.add(loader);
    return loader;
  }

  function load(loader: DocumentLoader, document: Pick<ConformanceDocument, "bytes" | "mimeType">): Promise<LoadedDocument> {
    return loader.load({ bytes: document.bytes, mimeType: document.mimeType }, ctx);
  }

  async function expectDistinct(loader: DocumentLoader, pairs: readonly [ConformanceDocument, LoadedDocument][]): Promise<void> {
    if (loader.capabilities.text && pairs.every(([fixture]) => fixture.expectedText.length > 0)) {
      for (const [fixture, loaded] of pairs) {
        for (const expected of fixture.expectedText) expect(loaded.text).toContain(expected);
      }
      return;
    }
    const images = await Promise.all(pairs.map(([, loaded]) => loaded.pages[0]?.image?.({ dpi: 72 })));
    expect(images.every((image) => image !== undefined)).toBe(true);
    expect(Buffer.from(images[0]!).equals(Buffer.from(images[1]!))).toBe(false);
  }

  describe(`loader conformance: ${options.name}`, () => {
    afterEach(async () => {
      const loaders = [...owned];
      owned.clear();
      await Promise.all(loaders.map((loader) => loader.dispose?.()));
    });

    it("loads distinct documents sequentially on one instance", async () => {
      const loader = await create();
      const first = await fixtures.document(21);
      const second = await fixtures.document(22);
      const firstResult = await load(loader, first);
      const secondResult = await load(loader, second);
      await expectDistinct(loader, [[first, firstResult], [second, secondResult]]);
    });

    it("loads distinct documents concurrently on one instance", async () => {
      const loader = await create();
      const first = await fixtures.document(23);
      const second = await fixtures.document(24);
      const [firstResult, secondResult] = await Promise.all([load(loader, first), load(loader, second)]);
      await expectDistinct(loader, [[first, firstResult], [second, secondResult]]);
    });

    it("declares itself honestly", async () => {
      const loader = await create();
      expect(loader.name).toBeTruthy();
      expect(loader.capabilities.mimeTypes.length).toBeGreaterThan(0);
      expect(loaderAccepts(loader, fixtures.mimeType)).toBe(true);
    });

    it("reads a document and finds its content", async (test) => {
      const loader = await create();
      const fixture = await fixtures.document(11);
      if (!loader.capabilities.text || fixture.expectedText.length === 0) test.skip();

      const document = await load(loader, fixture);

      expect(document.pages.length).toBeGreaterThan(0);
      expect(document.loader).toBeTruthy();
      for (const expected of fixture.expectedText) expect(document.text).toContain(expected);
    });

    it("numbers pages from 1, in order", async () => {
      const loader = await create();
      const document = await load(loader, await fixtures.document(12));

      expect(document.pages.length).toBeGreaterThan(0);
      expect(document.pages.map((p) => p.pageNumber)).toEqual(
        document.pages.map((_p, i) => i + 1),
      );
    });

    it("gives every page a real size", async (test) => {
      if (!fixtures.dimensions) test.skip();
      const loader = await create();
      const document = await load(loader, await fixtures.document(12));

      for (const page of document.pages) {
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
      }
    });

    it("keeps `text` consistent with the pages it came from", async () => {
      const loader = await create();
      const document = await load(loader, await fixtures.document(13));

      // Whole-document text must not invent or lose content relative to the pages.
      // Verbatim containment, not a token sample: a page's text is a substring of
      // the document's, which also pins down that the join preserves line breaks.
      for (const page of document.pages) {
        if (page.text.length > 0) expect(document.text).toContain(page.text);
      }
    });

    it("reports a text document as digital", async (test) => {
      const loader = await create();
      const fixture = await fixtures.document(14);
      if (!loader.capabilities.text || fixture.form !== "digital") test.skip();

      const document = await load(loader, fixture);
      expect(document.form).toBe("digital");
    });

    it.skipIf(options.skip?.multiPage === true)("spans a long document across pages", async (test) => {
      if (fixtures.multiPage === undefined) test.skip();
      const loader = await create();
      const fixture = await fixtures.multiPage!(15);

      const document = await load(loader, fixture);

      expect(fixture.pageCount).toBeGreaterThan(1);
      expect(document.pages.length).toBe(fixture.pageCount);
    });

    it.skipIf(options.skip?.scanned === true)("handles a page with no text without throwing", async (test) => {
      if (fixtures.scanned === undefined) test.skip();
      const loader = await create();
      const fixture = await fixtures.scanned!(16);

      // A loader may legitimately refuse a scan — but it must do so as a thrown
      // error the pipeline can fall back from, never as a bogus empty success.
      const document = await load(loader, fixture).catch(() => undefined);
      if (document === undefined) return;

      expect(document.text.trim().length).toBeLessThan(50);
      if (loader.capabilities.text) expect(document.form).toBe("scanned");
    });

    it.skipIf(options.skip?.geometry === true)("produces positioned geometry inside the page box", async (test) => {
      const loader = await create();
      const fixture = await fixtures.document(17);
      if (!loader.capabilities.geometry || fixture.expectedText.length === 0) test.skip();

      const document = await load(loader, fixture);
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

    it.skipIf(options.skip?.geometry === true)("puts the expected text in a line, not just in the page blob", async (test) => {
      const loader = await create();
      const fixture = await fixtures.document(18);
      const expected = fixture.expectedText[0];
      if (!loader.capabilities.geometry || expected === undefined) test.skip();

      const document = await load(loader, fixture);
      const lines = document.pages.flatMap((p) => p.lines ?? []);
      expect(lines.some((l) => l.text.includes(expected!))).toBe(true);
    });

    it.skipIf(options.skip?.images === true)("renders a page to an image on demand", async (test) => {
      const loader = await create();
      if (!loader.capabilities.images) test.skip();

      const document = await load(loader, await fixtures.document(19));
      const first = document.pages[0];
      expect(first?.image).toBeDefined();

      const bytes = await first?.image?.({ dpi: 72 });
      expect(bytes).toBeDefined();
      expect(bytes!.length).toBeGreaterThan(100);
      expect(looksLikeImage(bytes!)).toBe(true);
    });

    it("rejects an already-aborted signal instead of doing the work", async () => {
      const loader = await create();
      const fixture = await fixtures.document(20);
      const controller = new AbortController();
      controller.abort();

      await expect(
        loader.load(
          { bytes: fixture.bytes, mimeType: fixture.mimeType },
          { signal: controller.signal, logger: silentLogger },
        ),
      ).rejects.toThrow();
    });

    it("rejects bytes that are not a document of its kind", async (test) => {
      if (fixtures.invalid === undefined) test.skip();
      const loader = await create();
      await expect(load(loader, await fixtures.invalid!())).rejects.toThrow();
    });

    it("can be disposed, twice, without complaint", async () => {
      const loader = await create();
      await loader.dispose?.();
      await loader.dispose?.();
    });
  });
}
