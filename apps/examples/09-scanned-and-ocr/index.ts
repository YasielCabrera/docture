/**
 * No text layer.
 *
 *     pnpm --filter @docture/examples scanned              # the diagnosis
 *     RUN_OCR=1 pnpm --filter @docture/examples scanned    # + real OCR
 *     AI_GATEWAY_API_KEY=... RUN_OCR=1 pnpm ... scanned    # + a vision model
 *
 * Needs: `pnpm run fetch`. The diagnosis runs with no key and no OCR. OCR is behind
 * `RUN_OCR=1` because the first run downloads a WASM engine and models (tens of MB),
 * which is not something a `pnpm check` should depend on. Vision needs a key.
 *
 * The document is `scan-services` — a 1700x2200 page image of an invoice we ALSO have
 * as a PDF. That pairing is the point: the same document down two paths, scored against
 * the same published ground truth.
 *
 * HONESTLY, THOUGH: this PNG is a clean 200-DPI render, not a photograph. No skew, no
 * sensor noise, no JPEG artifacts. OCR does better here than it will on something
 * somebody scanned at an angle on a Tuesday. Treat the numbers below as a ceiling.
 *
 * Read top to bottom:
 *
 *   1. THE DIAGNOSIS — what a document with no text layer actually reports
 *   2. FIX ONE: OCR the pixels, and score it against the text-layer path
 *   3. TWO OCR ENGINES, one interface
 *   4. FIX TWO: show the page to a vision model
 *   5. A SCANNED PDF — where the rasterizer goes
 */

import { readFile } from "node:fs/promises";
import { Extractor, NoEligibleStrategyError, DoctureError, imageSize, withRasterizer } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr, PADDLE_MODELS } from "docture/loaders/paddleocr";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { vision } from "docture/llm";
import { scoreExtraction } from "docture/eval";
import { Invoice, ScoredInvoice, toScored } from "../shared/contracts.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { field, heading, note, provenance, step, table } from "../shared/print.js";
import { pathOf, truthPathOf } from "../shared/documents.js";
import { projectOntoTruth, readPublishedTruth } from "../shared/truth/published.js";
import { isMain, ocrEnabled, optionalModel, requireDocuments, run } from "../shared/run.js";

async function main(): Promise<void> {
  const [scanPath, pdfPath] = await requireDocuments("scan-services", "invoice-services");

  heading("A document with no text layer");

  // ── 1. The diagnosis ──────────────────────────────────────────────────────────

  step("1. the diagnosis");

  const scanBytes = new Uint8Array(await readFile(scanPath));
  const size = imageSize(scanBytes);
  field("the file", "scan-services (a PNG)");
  field("dimensions", `${size?.widthPx} x ${size?.heightPx} px`);
  field("text layer", "none — it is pixels");

  /**
   * The important part: a text-layer strategy is CORRECTLY never a candidate. You get a
   * wiring diagnosis naming the facts the document has, not a mysterious parse failure
   * or an empty invoice that looks like a real one.
   */
  const textOnly = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(servicesInvoiceParser());
  try {
    const outcome = await textOnly.safeExtract(scanPath, Invoice);
    if (!outcome.ok) {
      // `SafeExtraction`'s error is typed `Error`, so reaching `code` means narrowing to
      // the library's base class first. Every error here extends it.
      if (outcome.error instanceof DoctureError) field("error.code", outcome.error.code);
      field("message", outcome.error.message);
      if (outcome.error instanceof NoEligibleStrategyError) {
        field("features.hasTextLayer", outcome.error.features.hasTextLayer);
      }
    }
  } finally {
    await textOnly.dispose();
  }
  note(
    "That is NO_ELIGIBLE_LOADER, not NO_ELIGIBLE_STRATEGY: pdf.js does not accept\n" +
      "image/png at all, so the question of strategies never came up. Both failures are\n" +
      "in example 06's table, and telling them apart is the difference between 'wire a\n" +
      "loader' and 'OCR the document'.",
  );

  // The published truth, shared by both paths below.
  const truthPath = truthPathOf("scan-services");
  const truth = truthPath === undefined ? {} : await readPublishedTruth(truthPath);

  /** The text-layer path, as the baseline to beat. */
  const baseline = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(servicesInvoiceParser());
  let baselineF1 = 0;
  try {
    const result = await baseline.extractData(pdfPath, Invoice);
    baselineF1 = scoreExtraction(truth, projectOntoTruth(toScored(result), truth)).f1;
  } finally {
    await baseline.dispose();
  }

  // ── 2. Fix one: OCR the pixels ────────────────────────────────────────────────

  step("2. fix one — OCR the pixels");

  if (!ocrEnabled()) {
    note(
      "RUN_OCR is not set, so the OCR passes are skipped. The first run downloads a WASM\n" +
        "engine and language models — tens of megabytes — which is why it is opt-in rather\n" +
        "than something every `pnpm offline` pays for.\n\n" +
        "  RUN_OCR=1 pnpm --filter @docture/examples scanned\n\n" +
        "The wiring is three lines and it is worth reading even without running it:\n\n" +
        "  new Extractor()\n" +
        "    .loadDocumentLoader(new DocumentLoaderTesseract())   // accepts image/png\n" +
        "    .loadStrategy(servicesInvoiceParser())               // unchanged!\n\n" +
        "The strategy does not change. That is the whole argument for OCR being a LOADER\n" +
        "rather than a strategy: once the pixels have become text and geometry, every\n" +
        "parser you already wrote works on them.",
    );
  } else {
    /**
     * OCR is a LOADER, not a strategy. That is the design decision worth noticing: it
     * turns pixels into the same `TextLine` shape a text layer produces, so
     * `servicesInvoiceParser` — written against the PDF, months ago — reads the scan
     * unchanged.
     */
    const ocr = new Extractor()
      .loadDocumentLoader(new DocumentLoaderTesseract())
      .loadStrategy(servicesInvoiceParser());

    try {
      const started = Date.now();
      const outcome = await ocr.safeExtract(scanPath, Invoice);
      const ms = Date.now() - started;

      if (outcome.ok) {
        const scored = scoreExtraction(truth, projectOntoTruth(toScored(outcome.result.data), truth));
        table(
          [
            { header: "path", width: 26 },
            { header: "loader", width: 14 },
            { header: "F1 vs published truth", width: 21, right: true },
          ],
          [
            ["the PDF's text layer", "pdfjs", baselineF1.toFixed(3)],
            ["OCR on the page image", "tesseract", scored.f1.toFixed(3)],
          ],
        );
        provenance(outcome.result);
        field("\n  OCR wall time", `${ms} ms`);
        note(
          scored.f1 >= baselineF1
            ? "OCR matched the text layer on this document. It is a clean 200-DPI render of a\n" +
                "simple layout, which is the easy case — see the note at the top of this file."
            : `OCR lost ${((baselineF1 - scored.f1) * 100).toFixed(1)} points to the text layer.\n` +
                "That gap is the honest cost of reading pixels instead of text, and it is why a\n" +
                "text layer is always tried first when there is one.",
        );
      } else {
        field("OCR failed", outcome.error.message.slice(0, 70));
        note(
          "A parser written against a text layer meeting real OCR output for the first time\n" +
            "is exactly where geometry tolerances bite. This is worth seeing rather than\n" +
            "hiding: the fix is usually `linesFromWords`' `lineTolerance`, or a parser that\n" +
            "reads positions instead of exact strings.",
        );
      }
    } finally {
      await ocr.dispose();
    }

    // ── 3. Two OCR engines, one interface ───────────────────────────────────────

    step("3. two OCR engines, one interface");

    const rows: unknown[][] = [];
    for (const loader of [new DocumentLoaderTesseract(), new DocumentLoaderPaddleOcr()]) {
      const started = Date.now();
      try {
        const read = await loader.load(
          { bytes: scanBytes, mimeType: "image/png" },
          { signal: AbortSignal.timeout(300_000), logger: (await import("docture")).silentLogger },
        );
        const lineCount = read.pages.flatMap((p) => p.lines ?? []).length;
        rows.push([
          loader.name,
          `${read.text.trim().length.toLocaleString()} chars`,
          `${lineCount} lines`,
          `${Date.now() - started} ms`,
        ]);
      } catch (error) {
        rows.push([loader.name, `failed: ${(error as Error).message.slice(0, 24)}`, "—", "—"]);
      } finally {
        await loader.dispose?.();
      }
    }
    table(
      [
        { header: "loader", width: 16 },
        { header: "text recovered", width: 16 },
        { header: "geometry", width: 12 },
        { header: "wall", width: 10, right: true },
      ],
      rows,
    );
    field("PaddleOCR models available", Object.keys(PADDLE_MODELS).join(", "));
    note(
      "Both produce text AND positioned lines, through the same `linesFromWords` grouper\n" +
        "core exports — which is what makes a parser portable between them. Swapping engines\n" +
        "is swapping an import.",
    );
  }

  // ── 4. Fix two: show the page to a vision model ───────────────────────────────

  step("4. fix two — show the page to a vision model");

  const model = optionalModel();
  if (model === undefined) {
    note(
      "AI_GATEWAY_API_KEY is not set, so the vision pass is skipped. The wiring:\n\n" +
        "  const loader = withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer());\n" +
        "  new Extractor()\n" +
        "    .loadDocumentLoader(loader)                      // can now render pages\n" +
        "    .loadStrategy(vision({ model, dpi: 200 }))       // requires RENDERABLE_PAGES\n\n" +
        "`vision` declares `requires: [\"RENDERABLE_PAGES\"]`, so handing it the BARE loader\n" +
        "is a compile-time error rather than a failure on page 40. Example 04 is built\n" +
        "around that.",
    );
  } else {
    /**
     * A vision strategy needs pages it can render, so the loader is composed with a
     * rasterizer first. `pageMode` is the interesting knob:
     *
     *   - `together` — every page in one request. The model sees the whole document and
     *                  can resolve a total on page 3 against rows on page 1.
     *   - `perPage`  — one request each, merged. Cheaper per request, and the only option
     *                  when the document exceeds the model's image limit.
     */
    const rows: unknown[][] = [];
    for (const pageMode of ["together", "perPage"] as const) {
      const extractor = new Extractor()
        .loadDocumentLoader(withRasterizer(new DocumentLoaderPdfJs(), new MuPdfRasterizer()))
        .loadStrategy(
          vision({
            model: model.model,
            name: `vision-${pageMode}`,
            pageMode,
            // 200 is usually enough for a model to read; OCR wants 300.
            dpi: 200,
            // Caps the long edge, which keeps a model's image budget predictable.
            maxEdge: 1600,
            format: "png",
            maxPages: 4,
            temperature: 0,
          }),
        );
      try {
        const outcome = await extractor.safeExtract(pdfPath, Invoice);
        rows.push(
          outcome.ok
            ? [
                pageMode,
                `${outcome.result.data.lineItems.length} items`,
                outcome.result.usage.totalTokens.toLocaleString(),
                `${outcome.result.usage.wallMs} ms`,
              ]
            : [pageMode, `failed: ${outcome.error.message.slice(0, 20)}`, "—", "—"],
        );
      } finally {
        await extractor.dispose();
      }
    }
    table(
      [
        { header: "pageMode", width: 12 },
        { header: "result", width: 20 },
        { header: "tokens", width: 10, right: true },
        { header: "wall", width: 10, right: true },
      ],
      rows,
    );
  }

  // ── 5. A scanned PDF ──────────────────────────────────────────────────────────

  step("5. a scanned PDF — where the rasterizer goes");

  /**
   * A bare page image is one case. The common one is a PDF whose pages are pictures —
   * and then OCR needs a way to turn those pages into pixels. That is the `rasterizer`
   * option on the OCR loader, and it is a constructor argument rather than something
   * discovered at page 40.
   */
  const scannedPdfLoader = new DocumentLoaderTesseract({
    rasterizer: new NapiCanvasRasterizer({ dpi: 300 }),
  });
  field("loader", scannedPdfLoader.name);
  field("accepts", "PDF pages, by rendering them first");
  field("dpi", "300 — the usual floor for OCR accuracy");
  field("capabilities.geometry", scannedPdfLoader.capabilities.geometry);
  await scannedPdfLoader.dispose?.();

  note(
    "Loader choice is by media type and then declaration order. Empty text does not\n" +
      "select another loader. With this wiring, PDF.js reads PDFs and OCR reads images:\n\n" +
      "  .loadDocumentLoader(\n" +
      "    new DocumentLoaderPdfJs(),                              // PDFs with text\n" +
      "    new DocumentLoaderTesseract({ rasterizer }),            // PNG/JPEG here\n" +
      "  )\n\n" +
      "For scanned PDFs, select the Tesseract loader for PDFs or retry with an OCR\n" +
      "extractor after inspecting the text layer. `form` reports `digital`, `scanned`\n" +
      "or `mixed` so you can choose that path explicitly.",
  );

  console.log("\n  Next: 10-classification — what kind of document is this?");
}

if (isMain(import.meta.url)) await run(main);
