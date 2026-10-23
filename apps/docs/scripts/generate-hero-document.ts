/**
 * Generates the home page's hero artwork with the library it documents.
 *
 * The page shown in the hero is not a mockup. `makeInvoicePdf` writes a real PDF,
 * `DocumentLoaderPdfJs` reads its geometry, `NapiCanvasRasterizer` renders page 1,
 * and the highlight boxes are the loader's own coordinates for the spans that back
 * each schema field. If the pipeline regressed, this script would draw the boxes in
 * the wrong place.
 *
 *   pnpm --filter @docture/docs asset
 *
 * Output is committed, so a docs build never runs a rasterizer.
 */

import { appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { silentLogger, type LoadedPage, type Rasterizer, type TextSpan } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { formatMoney, makeInvoicePdf } from "docture/testing/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const libDir = join(here, "..", "lib");

/** Fixed, so the artwork and its ground truth never drift between machines. */
const SEED = 7;
const LINE_ITEMS = 5;

/**
 * Three unrelated documents, for the splitter cell. Different seeds mean different
 * sellers, buyers and line counts, so the strip reads as a bundle rather than as
 * the same page three times. Rendered small: they are 120px wide on the page.
 */
const BUNDLE = [
  { seed: 21, lineItemCount: 3 },
  { seed: 44, lineItemCount: 7 },
  { seed: 63, lineItemCount: 4 },
] as const;

/**
 * Each highlight names a schema field and the text on the page that produced it.
 * `match` is looked up in the loader's spans, so the box is measured, not authored.
 */
interface Highlight {
  readonly field: string;
  readonly type: string;
  /** What the extracted value is, printed beside the box. */
  readonly value: string;
  /** Every span the field is built from. The box is their union. */
  readonly match: readonly string[];
  /** Grow the measured box outward, in PDF points, so the rule does not touch glyphs. */
  readonly pad: number;
}

/** A box in page-relative units (0-1), which is what CSS percentages want. */
interface Box {
  readonly field: string;
  readonly type: string;
  readonly value: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function spansOf(page: LoadedPage): readonly TextSpan[] {
  return (page.lines ?? []).flatMap((line) => line.spans);
}

/** The union of every span containing one of `needles`, padded, in page-relative units. */
function measure(page: LoadedPage, needles: readonly string[], pad: number): Omit<Box, "field" | "type" | "value"> {
  const spans = spansOf(page).filter((span) => needles.some((needle) => span.text.includes(needle)));
  if (spans.length === 0) {
    throw new Error(`No span on page ${String(page.pageNumber)} matches ${JSON.stringify(needles)}`);
  }

  const x = Math.min(...spans.map((s) => s.x)) - pad;
  const y = Math.min(...spans.map((s) => s.y)) - pad;
  const right = Math.max(...spans.map((s) => s.x + s.width)) + pad;
  const bottom = Math.max(...spans.map((s) => s.y + s.height)) + pad;

  return {
    left: x / page.width,
    top: y / page.height,
    width: (right - x) / page.width,
    height: (bottom - y) / page.height,
  };
}

async function main(): Promise<void> {
  const { bytes, expected } = await makeInvoicePdf({ seed: SEED, lineItemCount: LINE_ITEMS });
  const document = { bytes, fileName: "invoice.pdf", mimeType: "application/pdf" };
  const ctx = { signal: AbortSignal.timeout(60_000), logger: silentLogger };

  const loaded = await new DocumentLoaderPdfJs().load(document, ctx);
  const page = loaded.pages[0];
  if (!page) throw new Error("The generated invoice has no first page.");

  // Three fields: enough to read "regions become fields" at a glance, few enough
  // that the boxes do not fight the page. `match` is every span the field is built
  // from, so `lineItems` wraps the whole table rather than one cell.
  const highlights: readonly Highlight[] = [
    {
      field: "invoiceNumber",
      type: "string",
      value: expected.invoiceNumber,
      match: [expected.invoiceNumber],
      pad: 4,
    },
    {
      field: "lineItems",
      type: "LineItem[]",
      value: `${String(expected.lineItems.length)} rows`,
      match: expected.lineItems.flatMap((item) => [item.description, formatMoney(item.amount)]),
      pad: 6,
    },
    {
      field: "total",
      type: "number",
      value: formatMoney(expected.total),
      match: [formatMoney(expected.total)],
      pad: 5,
    },
  ];

  // The document is A4 but the invoice stops well short of the fold. Crop to where
  // the text actually ends, so the hero frames a full page rather than half a page
  // of white. Measured from the loader, so it follows the content.
  const bottom = Math.max(...spansOf(page).map((span) => span.y + span.height));
  const crop = Math.min(1, (bottom + 36) / page.height);

  const boxes: Box[] = highlights.map((highlight) => {
    const measured = measure(page, highlight.match, highlight.pad);
    return {
      field: highlight.field,
      type: highlight.type,
      value: highlight.value,
      left: measured.left,
      width: measured.width,
      // Into crop space, so the component can use these against the framed image.
      top: measured.top / crop,
      height: measured.height / crop,
    };
  });

  // As a Rasterizer, so the optional dispose() on the contract is visible.
  const rasterizer: Rasterizer = new NapiCanvasRasterizer();
  const [rendered] = await rasterizer.rasterize(document, { dpi: 144, format: "png", pages: [1] }, ctx);
  if (!rendered) throw new Error("The rasterizer returned no pages.");

  await writeFile(join(publicDir, "hero-invoice.png"), rendered.bytes);
  await writeFile(
    join(libDir, "hero-document.ts"),
    `${[
      "// GENERATED by scripts/generate-hero-document.ts. Do not edit.",
      "//",
      "// The boxes are DocumentLoaderPdfJs' own span coordinates for the spans that back",
      "// each field, normalised against the page. Regenerate with:",
      "//   pnpm --filter @docture/docs asset",
      "",
      "export interface HeroBox {",
      "  readonly field: string;",
      "  readonly type: string;",
      "  readonly value: string;",
      "  /** Page-relative, 0-1. */",
      "  readonly left: number;",
      "  readonly top: number;",
      "  readonly width: number;",
      "  readonly height: number;",
      "}",
      "",
      "export const heroImage = {",
      '  src: "/hero-invoice.png",',
      `  width: ${String(rendered.widthPx)},`,
      `  height: ${String(rendered.heightPx)},`,
      "  /** Fraction of the page height the hero frames. The invoice ends here. */",
      `  crop: ${crop.toFixed(4)},`,
      "} as const;",
      "",
      `export const heroBoxes: readonly HeroBox[] = ${JSON.stringify(boxes, null, 2)};`,
      "",
    ].join("\n")}`,
  );

  // The bundle strip. Same pipeline, one PDF per document, rendered small.
  const bundle: { readonly src: string; readonly width: number; readonly height: number }[] = [];
  for (const [index, options] of BUNDLE.entries()) {
    const doc = await makeInvoicePdf(options);
    const [page] = await rasterizer.rasterize(
      { bytes: doc.bytes, fileName: `bundle-${String(index + 1)}.pdf`, mimeType: "application/pdf" },
      { dpi: 48, format: "png", pages: [1] },
      ctx,
    );
    if (!page) throw new Error(`The rasterizer returned no page for bundle ${String(index + 1)}.`);
    const name = `bundle-${String(index + 1)}.png`;
    await writeFile(join(publicDir, name), page.bytes);
    bundle.push({ src: `/${name}`, width: page.widthPx, height: page.heightPx });
  }

  await appendFile(
    join(libDir, "hero-document.ts"),
    `\nexport const bundlePages = ${JSON.stringify(bundle, null, 2)} as const;\n`,
  );

  await rasterizer.dispose?.();

  console.log(`hero-invoice.png  ${String(rendered.widthPx)}x${String(rendered.heightPx)}  crop ${(crop * 100).toFixed(1)}%`);
  for (const box of boxes) {
    console.log(
      `  ${box.field.padEnd(14)} ${box.value.padEnd(12)} ` +
        `${(box.left * 100).toFixed(1)}% ${(box.top * 100).toFixed(1)}%`,
    );
  }
  console.log(`bundle          ${String(bundle.length)} pages at ${String(bundle[0]?.width ?? 0)}px`);
}

await main();
