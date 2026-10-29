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
 * The eval evidence below the hero comes from the same kind of run. The script
 * executes `examples/synthetic-corpus.ts`, keeps its stdout as the claim the page
 * makes, and renders the corpus that example wrote, with the generator's own label
 * boxes. `check-examples.ts` asserts the example still prints that line.
 *
 * Output is committed, so a docs build never runs a rasterizer.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { silentLogger, type LoadedPage, type Rasterizer, type TextSpan } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { formatMoney, makeInvoicePdf } from "docture/testing/fixtures";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const libDir = join(here, "..", "lib");
const docsDir = join(here, "..");

/** Fixed, so the artwork and its ground truth never drift between machines. */
const SEED = 7;
const LINE_ITEMS = 5;

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

const Case = z.object({
  id: z.string(),
  documents: z.array(z.string()).min(1),
  tags: z.record(z.string(), z.string()),
  params: z.object({ seed: z.number(), kind: z.string(), severity: z.number().optional(), dpi: z.number().optional() }),
});
type Case = z.infer<typeof Case>;

const Labels = z.array(
  z.object({
    path: z.string(),
    text: z.string(),
    pageNumber: z.number(),
    box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  }),
);

const EVIDENCE_DPI = 144;

function renditionLabel({ params }: Case): string {
  if (params.kind === "digital") return "Digital PDF";
  if (params.kind === "scan" && params.severity !== undefined && params.dpi !== undefined) {
    return `Scan, severity ${String(params.severity)} at ${String(params.dpi)} dpi`;
  }
  throw new Error(`No label for the ${params.kind} rendition.`);
}

/** Runs the documented example, so the numbers on the page are the numbers it prints. */
async function runCorpusExample(scratch: string): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), join(docsDir, "examples/synthetic-corpus.ts")],
    {
      cwd: scratch,
      // The example writes its corpus under os.tmpdir(); pointing that at the scratch
      // directory is how this script finds the documents the eval scored.
      env: { ...process.env, TMPDIR: scratch, TSX_TSCONFIG_PATH: join(docsDir, "tsconfig.json") },
      timeout: 120_000,
    },
  );
  return stdout.trim();
}

async function writeEvalEvidence(rasterizer: Rasterizer, ctx: { signal: AbortSignal; logger: typeof silentLogger }): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "docture-eval-evidence-"));
  try {
    const summary = await runCorpusExample(scratch);
    const parsed = /^(\d+) cases, digital F1 ([\d.]+), scan F1 ([\d.]+)$/u.exec(summary);
    if (!parsed) throw new Error(`Unexpected synthetic-corpus output: ${summary}`);
    const [, caseCount = "", digitalF1 = "", scanF1 = ""] = parsed;

    const [corpusName, ...others] = (await readdir(scratch)).filter((name) => name.startsWith("synthetic-corpus-"));
    if (corpusName === undefined || others.length > 0) throw new Error(`Expected one corpus in ${scratch}.`);
    const corpus = join(scratch, corpusName);

    const cases = (await readFile(join(corpus, "manifest.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => Case.parse(JSON.parse(line)));
    const digital = cases.find((item) => item.tags["scenario"] === "base" && item.tags["rendition"] === "digital");
    const scan = cases.find(
      (item) => item.tags["scenario"] === "base" && item.tags["rendition"] === "scan" && item.params.seed === digital?.params.seed,
    );
    if (!digital || !scan) throw new Error("The corpus has no base digital and scan pair of one seed.");

    async function render(item: Case, name: string) {
      const [path = ""] = item.documents;
      const bytes = await readFile(join(corpus, path));
      const [page] = await rasterizer.rasterize(
        { bytes, fileName: `${item.id}.pdf`, mimeType: "application/pdf" },
        { dpi: EVIDENCE_DPI, format: "png", pages: [1] },
        ctx,
      );
      if (!page) throw new Error(`The rasterizer returned no page for ${item.id}.`);
      await writeFile(join(publicDir, name), page.bytes);
      return { src: `/${name}`, width: page.widthPx, height: page.heightPx };
    }
    const digitalImage = await render(digital, "eval-digital.png");
    const scanImage = await render(scan, "eval-scan.png");

    // Labels are PDF points with a top-left origin, the same frame the template draws in.
    const labels = Labels.parse(
      JSON.parse(await readFile(join(corpus, dirname(digital.documents[0] ?? ""), "labels.json"), "utf8")),
    ).filter((label) => label.pageNumber === 1);
    const pageWidth = (digitalImage.width * 72) / EVIDENCE_DPI;
    const pageHeight = (digitalImage.height * 72) / EVIDENCE_DPI;
    const bottom = Math.max(...labels.map((label) => label.box.y + label.box.height));
    const crop = Number(Math.min(1, (bottom + 36) / pageHeight).toFixed(4));
    const pad = 2;

    // Every usage row also labels its description and kWh. Boxing those too turns
    // a small card into a grid of outlines, so the card shows the header fields
    // and the money column.
    const boxes = labels
      .filter((label) => !/^usage\[\d+\]\.(?:description|kwh)$/u.test(label.path))
      .map(({ path, box }) => ({
        path,
        left: (box.x - pad) / pageWidth,
        top: (box.y - pad) / (pageHeight * crop),
        width: (box.width + pad * 2) / pageWidth,
        height: (box.height + pad * 2) / (pageHeight * crop),
      }));

    const text = (path: string) => labels.find((label) => label.path === path)?.text ?? "";
    const evidence = {
      summary,
      caseCount: Number(caseCount),
      renditions: [
        {
          ...digitalImage,
          crop,
          alt: `A generated utility bill for ${text("customerName")}, amount due ${text("amountDueCents")}, with its labeled fields outlined`,
          label: renditionLabel(digital),
          f1: Number(digitalF1),
          boxes,
        },
        {
          ...scanImage,
          crop,
          alt: "The same bill rendered as a degraded scan with speckles and a slight skew",
          label: renditionLabel(scan),
          f1: Number(scanF1),
          boxes: [],
        },
      ],
    };

    await writeFile(
      join(libDir, "eval-evidence.ts"),
      [
        "// GENERATED by scripts/generate-hero-document.ts. Do not edit.",
        "//",
        "// Output of examples/synthetic-corpus.ts: its stdout line, the base digital and",
        "// scan cases of one seed, and the digital case's label boxes, relative to the",
        "// cropped image (0-1). Regenerate with:",
        "//   pnpm --filter @docture/docs asset",
        "",
        `export const evalEvidence = ${JSON.stringify(evidence, null, 2)} as const;`,
        "",
        "export const { summary } = evalEvidence;",
        "",
      ].join("\n"),
    );

    console.log(`eval evidence     ${summary}  crop ${(crop * 100).toFixed(1)}%  ${String(boxes.length)} boxes`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
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
      `  alt: ${JSON.stringify(
        `A generated invoice, ${expected.invoiceNumber}, with ${String(expected.lineItems.length)} line items and a total of ${formatMoney(expected.total)} ${expected.currency}`,
      )},`,
      "} as const;",
      "",
      `export const heroBoxes: readonly HeroBox[] = ${JSON.stringify(boxes, null, 2)};`,
      "",
      "/** The ground truth for the invoice, as `result.data` would hold it. */",
      `export const heroResult = ${JSON.stringify(
        { invoiceNumber: expected.invoiceNumber, lineItemCount: expected.lineItems.length, total: expected.total },
        null,
        2,
      )} as const;`,
      "",
    ].join("\n")}`,
  );

  await writeEvalEvidence(rasterizer, ctx);
  await rasterizer.dispose?.();

  console.log(`hero-invoice.png  ${String(rendered.widthPx)}x${String(rendered.heightPx)}  crop ${(crop * 100).toFixed(1)}%`);
  for (const box of boxes) {
    console.log(
      `  ${box.field.padEnd(14)} ${box.value.padEnd(12)} ` +
        `${(box.left * 100).toFixed(1)}% ${(box.top * 100).toFixed(1)}%`,
    );
  }
}

await main();
