/**
 * The wiring mistake that is a compile error.
 *
 *     pnpm --filter @docture/examples capabilities
 *
 * Needs: `pnpm run fetch`. No API key.
 *
 * Half of this example is checked by `pnpm typecheck` rather than by running it. The
 * `@ts-expect-error` lines below are the point: each one is a wiring mistake the
 * compiler catches, and if the library ever stopped catching one, THE TYPECHECK WOULD
 * FAIL because the expected error went missing.
 *
 * Read top to bottom:
 *
 *   1. A LOADER PUBLISHES WHAT IT CAN DO, as a type
 *   2. A STRATEGY DEMANDS A FACT, and the document either has it or does not
 *   3. READING AND RENDERING ARE SEPARATE PLUGINS — `withRasterizer`
 *   4. TWO RASTERIZERS, one seam
 *   5. PAGE IMAGES ARE LAZY, and here is the render count that proves it
 */

import { DEFAULT_RASTER_OPTIONS, DocumentLoaderData, Extractor, MIN_TEXT_LAYER_CHARS, NoEligibleStrategyError, defineRasterizer, defineStrategy, hasFact, withRasterizer, type GeometryLoader, type ImageLoader, type RasterOptions, type Rasterizer, type TextLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderMuPdf, MuPdfRasterizer } from "docture/loaders/mupdf";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { z } from "zod";
import { field, heading, note, step, table } from "../shared/print.js";
import { isMain, requireDocument, run } from "../shared/run.js";

// ── 1. A loader publishes what it can do, as a type ─────────────────────────────

/**
 * These four assignments are the whole feature. They are checked when you run
 * `pnpm typecheck`, and they cost nothing at run time.
 *
 * `GeometryLoader` is `DocumentLoader<LoaderCapabilities<boolean, true, boolean>>` — a
 * loader whose `geometry` is the literal `true`. `DocumentLoaderData` reports
 * `geometry: false`, so it is not one, and the compiler says so AT THE WIRING SITE
 * rather than halfway through someone's 400-page document.
 */
const pdfjsIsText: TextLoader = new DocumentLoaderPdfJs();
const pdfjsHasGeometry: GeometryLoader = new DocumentLoaderPdfJs();
const dataIsText: TextLoader = new DocumentLoaderData();

// @ts-expect-error — DocumentLoaderData reports `geometry: false`, so it is not a
// GeometryLoader. This is the error the library exists to produce.
const dataHasGeometry: GeometryLoader = new DocumentLoaderData();

// @ts-expect-error — nor can it render. `images: false`.
const dataCanRender: ImageLoader = new DocumentLoaderData();

// @ts-expect-error — and neither can pdf.js on its own. Rendering is a separate
// plugin; see section 3.
const pdfjsCanRender: ImageLoader = new DocumentLoaderPdfJs();

async function main(): Promise<void> {
  const path = await requireDocument("statement");

  heading("Capabilities and composition");

  step("1. a loader publishes what it can do");

  table(
    [
      { header: "loader", width: 22 },
      { header: "text", width: 6 },
      { header: "geometry", width: 10 },
      { header: "images", width: 8 },
    ],
    [new DocumentLoaderPdfJs(), new DocumentLoaderMuPdf(), new DocumentLoaderData()].map((l) => [
      l.name,
      l.capabilities.text,
      l.capabilities.geometry,
      l.capabilities.images,
    ]),
  );
  note(
    "The four `@ts-expect-error` lines at the top of this file are the interesting part,\n" +
      "and they are checked by `pnpm typecheck`, not by this run. Delete one and the\n" +
      "typecheck fails — because the error it expects would no longer be there.",
  );

  // ── 2. A strategy demands a fact ─────────────────────────────────────────────

  step("2. a strategy demands a fact");

  /**
   * `requires` is about the DOCUMENT, not about the loader. A strategy whose
   * requirements the document fails is not a candidate and never runs — which is why
   * the failure below is a wiring diagnosis rather than a mysterious parse error.
   *
   * Note what does NOT belong in `requires`: an OCR engine, a model client, a
   * rasterizer. Those are constructor arguments, satisfied by construction.
   */
  const needsGeometry = defineStrategy({
    name: "needs-geometry",
    requires: ["TEXT_LAYER", "GEOMETRY"],
    async extract(ctx) {
      const lines = ctx.document.pages.flatMap((page) => page.lines ?? []);
      return { data: { lineCount: lines.length, firstLineY: lines[0]?.y ?? null } };
    },
  });

  const Geometry = z.object({ lineCount: z.number(), firstLineY: z.number().nullable() });

  // pdf.js produces geometry, so this runs.
  const withGeometry = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(needsGeometry);
  try {
    const result = await withGeometry.extractData(path, Geometry);
    field("via pdfjs", `${result.lineCount} positioned lines, first at y=${result.firstLineY}`);
  } finally {
    await withGeometry.dispose();
  }

  /**
   * `DocumentLoaderData` does not. The same strategy is simply not a candidate, and the
   * error names the facts the document has and the ones it was asked for.
   */
  const withoutGeometry = new Extractor()
    .loadDocumentLoader(new DocumentLoaderData())
    .loadStrategy(needsGeometry);
  try {
    const outcome = await withoutGeometry.safeExtract(
      { bytes: new TextEncoder().encode(
          // Comfortably over MIN_TEXT_LAYER_CHARS, so the text layer is NOT the problem.
          "A text file has plenty of text and no coordinates whatsoever. ".repeat(4),
        ), mimeType: "text/plain" },
      Geometry,
    );
    if (!outcome.ok && outcome.error instanceof NoEligibleStrategyError) {
      field("via DocumentLoaderData", outcome.error.code);
      field("message", outcome.error.message.split("\n")[0] ?? "");
      // The features that made it ineligible are ON the error, so a caller can branch
      // on them instead of matching a string.
      field("features.hasGeometry", outcome.error.features.hasGeometry);
      field("features.hasTextLayer", outcome.error.features.hasTextLayer);
    }
  } finally {
    await withoutGeometry.dispose();
  }

  note(
    "`hasFact` is the one place a fact is interpreted, and it is public so a custom\n" +
      "strategy can ask the same question the pipeline asks:",
  );
  const features = { mimeType: "text/plain", pageCount: 1, textLength: 400, hasTextLayer: true, hasGeometry: false, hasRenderablePages: false, form: "digital" as const };
  console.log("");
  field('hasFact(features, "TEXT_LAYER")', hasFact(features, "TEXT_LAYER"));
  field('hasFact(features, "GEOMETRY")', hasFact(features, "GEOMETRY"));
  field("MIN_TEXT_LAYER_CHARS", `${MIN_TEXT_LAYER_CHARS} — below this, it is a scan`);

  // ── 3. Reading and rendering are separate plugins ────────────────────────────

  step("3. reading and rendering are separate plugins");

  /**
   * Bundling these into one plugin would mean choosing an OCR engine also chooses how
   * pages get rendered. Here they compose, and the COMPOSITION'S TYPE says it can now
   * do both.
   */
  const rasterizer: Rasterizer = new NapiCanvasRasterizer({ dpi: 150 });
  const renderable = withRasterizer(new DocumentLoaderPdfJs(), rasterizer);

  // Now it IS an ImageLoader. The bare loader (line 66 above) is not.
  const nowRenders: ImageLoader = renderable;

  field("composed loader name", renderable.name);
  field("capabilities.images", renderable.capabilities.images);
  field("assignable to ImageLoader", nowRenders === renderable ? "yes" : "no");
  field("default raster options", JSON.stringify(DEFAULT_RASTER_OPTIONS));

  // ── 4. Two rasterizers, one seam ─────────────────────────────────────────────

  step("4. two rasterizers, one seam");

  /**
   * `NapiCanvasRasterizer` renders through pdf.js onto @napi-rs/canvas.
   * `MuPdfRasterizer` renders through MuPDF's own WASM engine. Same interface, same
   * `RasterOptions`, and either composes onto either loader.
   */
  const options: RasterOptions = { dpi: 100, format: "png", maxEdge: 900 };
  const both: readonly (readonly [string, Rasterizer])[] = [
    ["NapiCanvasRasterizer", new NapiCanvasRasterizer()],
    ["MuPdfRasterizer", new MuPdfRasterizer()],
  ];

  const rows: unknown[][] = [];
  for (const [name, raster] of both) {
    const loader = withRasterizer(new DocumentLoaderPdfJs(), raster);
    const extractor = new Extractor().loadDocumentLoader(loader).loadStrategy(
      defineStrategy({
        name: `render-one-page-${name}`,
        requires: ["RENDERABLE_PAGES"],
        async extract(ctx) {
          const page = ctx.document.pages[0];
          const image = await page?.image?.(options);
          return { data: { bytes: image?.length ?? 0 } };
        },
      }),
    );
    try {
      const started = Date.now();
      const { bytes } = await extractor.extractData(path, z.object({ bytes: z.number() }));
      rows.push([name, `${(bytes / 1024).toFixed(0)} KB`, `${Date.now() - started} ms`]);
    } finally {
      await extractor.dispose();
    }
  }
  table(
    [
      { header: "rasterizer", width: 22 },
      { header: "page 1 at 100 dpi", width: 18, right: true },
      { header: "wall", width: 10, right: true },
    ],
    rows,
  );

  // ── 5. Page images are lazy ──────────────────────────────────────────────────

  step("5. page images are lazy, and memoized");

  /**
   * The statement is six pages. A strategy that looks at two of them should pay for two
   * renders, not six — and asking for the same page twice should pay once.
   *
   * This wraps the rasterizer to count calls, which is the only honest way to show it.
   */
  const inner: Rasterizer = new MuPdfRasterizer();
  let renders = 0;
  const counting: Rasterizer = defineRasterizer({
    name: "counting",
    formats: ["png", "jpeg"],
    // `withRasterizer` sets `options.pages` to the single page being asked for, which
    // is exactly what makes the laziness visible from here.
    async rasterize(document, options, ctx) {
      renders += options.pages?.length ?? 0;
      return inner.rasterize(document, options, ctx);
    },
    dispose: () => inner.dispose?.() ?? Promise.resolve(),
  });

  const lazy = new Extractor()
    .loadDocumentLoader(withRasterizer(new DocumentLoaderPdfJs(), counting))
    .loadStrategy(
      defineStrategy({
        name: "touch-two-pages",
        requires: ["RENDERABLE_PAGES"],
        async extract(ctx) {
          const [first, , third] = ctx.document.pages;
          const call = { signal: ctx.signal };
          await first?.image?.(undefined, call);
          await third?.image?.(undefined, call);
          // The same page again. Memoized, so this must not add a render.
          await first?.image?.(undefined, call);
          return { data: { touched: 3 } };
        },
      }),
    );

  try {
    await lazy.extractData(path, z.object({ touched: z.number() }));
    field("pages in the document", 6);
    field("image() calls made", 3);
    field("distinct pages touched", 2);
    field("actual renders", renders);
    console.log(
      renders === 2
        ? "\n  Two renders for three calls across six pages. Lazy, and memoized."
        : `\n  Expected 2 renders, got ${renders}.`,
    );
  } finally {
    await lazy.dispose();
  }

  console.log("\n  Next: 05-your-own-plugins — writing a strategy, a loader and a rasterizer.");
}

if (isMain(import.meta.url)) await run(main);

// Referenced so the type-level assertions above are not flagged as unused. They exist
// to be typechecked, not to be called.
export const TYPE_ASSERTIONS = {
  pdfjsIsText,
  pdfjsHasGeometry,
  dataIsText,
  dataHasGeometry,
  dataCanRender,
  pdfjsCanRender,
};
