/**
 * The extension points, written out.
 *
 *     pnpm --filter @docture/examples plugins
 *
 * Needs: `pnpm fetch`. No API key.
 *
 * Everything in this library that reads a document is one of four plain objects. No
 * base class, nothing to extend — `implements` is structural, so a fake in a test is an
 * object literal and a real plugin is whatever wraps your library of choice.
 *
 * Read top to bottom:
 *
 *   1. A STRATEGY, built up in three passes on a real invoice
 *   2. WHY IT THROWS instead of returning a half-filled object
 *   3. A LOADER, for a format this library has never heard of
 *   4. A RASTERIZER, and the one thing it owes its caller
 */

import { readFile } from "node:fs/promises";
import {
  Extractor,
  defineLoader,
  defineRasterizer,
  defineStrategy,
  imageSize,
  inferForm,
  linesFromWords,
  silentLogger,
  textFromLines,
  type ExtractionStrategy,
  type LoadedPage,
  type PositionedWord,
  type Rasterizer,
} from "docture";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { MuPdfRasterizer } from "@docture/loader-mupdf";
import { z } from "zod";
import { Invoice } from "../shared/contracts.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { amount, field, heading, note, provenance, step, table } from "../shared/print.js";
import { isMain, requireDocument, run } from "../shared/run.js";
import { capture, lines, money, required } from "../shared/text.js";

// ── 1. A strategy, in three passes ──────────────────────────────────────────────

/**
 * PASS ONE. The smallest strategy that is not a lie.
 *
 * Three fields matter: `name` shows up as `result.method`, `requires` decides whether
 * this is even a candidate, and `extract` does the work. That is the entire interface.
 */
const pass1: ExtractionStrategy = defineStrategy({
  name: "invoice-number-only",
  requires: ["TEXT_LAYER"],
  async extract(ctx) {
    const all = lines(ctx.document);
    return { data: { invoiceNumber: capture(all, /^#\s*(\S+)$/) } };
  },
});

/**
 * PASS TWO. `ctx` is the interesting part, and there are five things on it.
 *
 *   - `document`   the loaded pages, with text and (here) positioned geometry
 *   - `features`   what the load found; the same thing `requires` was checked against
 *   - `schema`     the caller's contract, already settled — see example 02
 *   - `signal`     cancellation. Long work should check it.
 *   - `logger`     structured, and already scoped to this strategy
 *
 * What is NOT on it: a model, a rasterizer, an OCR engine. Those are constructor
 * arguments of the strategy that needs them, so they are satisfied by construction
 * rather than discovered as a throw on page 40.
 */
const pass2: ExtractionStrategy = defineStrategy({
  name: "invoice-with-context",
  requires: ["TEXT_LAYER"],
  needsClassification: "none",
  async extract(ctx) {
    ctx.signal.throwIfAborted();
    ctx.logger.debug("reading the item table", { pages: ctx.features.pageCount });

    const all = lines(ctx.document);
    // The schema is available, so a strategy can report against the shape it was asked
    // for rather than guessing. `jsonSchema` is the promise-free JSON Schema.
    const wanted = Object.keys(
      (ctx.schema.jsonSchema["properties"] ?? {}) as Record<string, unknown>,
    );

    return {
      data: {
        invoiceNumber: capture(all, /^#\s*(\S+)$/),
        fieldsRequested: wanted.length,
        lineCount: all.length,
      },
      // Optional. A strategy that spent tokens says so here, and the pipeline folds it
      // into `result.usage` — which is how the split cost in example 11 shows up.
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  },
});

/**
 * PASS THREE is `shared/parsers/services.ts`, which is the same shape with the item
 * table filled in. It is a separate file only because fourteen other examples import
 * it — go read it; it is 120 lines and this is the last thing you need to know about it.
 */

async function main(): Promise<void> {
  const path = await requireDocument("invoice-services");

  heading("Writing your own plugins");

  step("1. a strategy, in three passes");

  for (const [label, strategy, schema] of [
    ["pass 1 — the minimum", pass1, z.object({ invoiceNumber: z.string() })],
    [
      "pass 2 — using ctx",
      pass2,
      z.object({ invoiceNumber: z.string(), fieldsRequested: z.number(), lineCount: z.number() }),
    ],
  ] as const) {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadStrategy(strategy);
    try {
      const data = await extractor.extractData(path, schema);
      field(label, JSON.stringify(data));
    } finally {
      await extractor.dispose();
    }
  }

  const full = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(servicesInvoiceParser());
  try {
    const result = await full.extract(path, Invoice);
    field(
      "pass 3 — the real one",
      `${result.data.lineItems.length} line items, total ${amount(result.data.total)}`,
    );
  } finally {
    await full.dispose();
  }

  // ── 2. Why it throws ─────────────────────────────────────────────────────────

  step("2. why a strategy throws instead of abstaining");

  /**
   * There is no "abstain". An empty result is indistinguishable from a real one for a
   * document that genuinely has no rows — so a strategy that cannot do the job MUST
   * throw, and let the next one try.
   *
   * The two parsers below are the live case. `services-invoice-parser` has no Odoo item
   * table to find on this document, throws, and the next strategy answers. The failure
   * is recorded, with its message, on `result.attempts`.
   */
  const chain = new Extractor().loadDocumentLoader(new DocumentLoaderPdfJs()).loadStrategy(
    defineStrategy({
      name: "wrong-layout-parser",
      requires: ["TEXT_LAYER"],
      async extract(ctx) {
        const all = lines(ctx.document);
        const head = all.findIndex((line) => /^Description\s+Quantity/.test(line));
        // The one line that matters in this whole example.
        if (head === -1) throw new Error("no Odoo item table header found");
        return { data: {} };
      },
    }),
    servicesInvoiceParser(),
  );

  try {
    const result = await chain.extract(path, Invoice);
    provenance(result);
    note(
      "A strategy that returned `{ lineItems: [] }` here would have WON, and reported an\n" +
        "invoice with no line items as a success. That is the bug this rule exists to make\n" +
        "impossible.",
    );
  } finally {
    await chain.dispose();
  }

  // ── 3. A loader for a format this library never heard of ─────────────────────

  step("3. a loader for a format nobody wrote a loader for");

  /**
   * A made-up positional format: `x,y,text` per line. Contrived, but the three helpers
   * it needs are the three every real geometry loader needs, and they are public for
   * exactly that reason.
   *
   *   - `linesFromWords`  group positioned words into visual lines. A text layer,
   *                       Tesseract and PaddleOCR all report words differently and must
   *                       arrive at the same `TextLine` shape, or no parser downstream
   *                       can be shared.
   *   - `textFromLines`   lines back to a text blob
   *   - `inferForm`       the digital / scanned verdict, from per-page text length
   *
   * `defineLoader` is an identity function whose only job is the `const` type parameter:
   * without it `{ text: true }` widens to `boolean` and the compile-time capability
   * check in example 04 silently stops working.
   */
  const csvLoader = defineLoader({
    name: "xy-csv",
    capabilities: {
      text: true,
      geometry: true,
      images: false,
      mimeTypes: ["text/x-xy-csv"],
    },
    async load(document) {
      const words: PositionedWord[] = [];
      for (const row of new TextDecoder().decode(document.bytes).split("\n")) {
        const [x, y, ...rest] = row.split(",");
        if (x === undefined || y === undefined || rest.length === 0) continue;
        const text = rest.join(",").trim();
        const left = Number(x);
        const top = Number(y);
        words.push({
          text,
          // `box` is [xMin, yMin, xMax, yMax], top-left origin — the shape every
          // producer normalises to, so no loader has to flip an axis and no parser
          // has to ask which way is up.
          box: [left, top, left + text.length * 6, top + 10],
        });
      }

      // Words sharing a y become one line. `scale` is here for the OCR case: an engine
      // working on a 300-DPI raster passes `72 / 300` to land back in PDF points.
      const textLines = linesFromWords(words, { lineTolerance: 0.5 });
      const page: LoadedPage = {
        pageNumber: 1,
        width: 612,
        height: 792,
        text: textFromLines(textLines),
        lines: textLines,
      };

      return {
        pages: [page],
        text: page.text,
        form: inferForm([page.text.trim().length]),
        loader: "xy-csv",
      };
    },
  });

  const csv = [
    "50,100,Invoice",
    "300,100,#XY-001",
    "50,140,Widget",
    "300,140,42.00",
    "50,160,Gadget",
    "300,160,58.00",
    "50,180,Flange",
    "300,180,13.25",
    "50,200,Grommet",
    "300,200,7.80",
    "50,240,Total",
    "300,240,121.05",
  ].join("\n");

  const csvExtractor = new Extractor().loadDocumentLoader(csvLoader).loadStrategy(
    defineStrategy({
      name: "xy-csv-parser",
      requires: ["TEXT_LAYER", "GEOMETRY"],
      async extract(ctx) {
        const all = lines(ctx.document);
        const items = all
          .map((line) => /^(\w+)\s+([\d.]+)$/.exec(line))
          .filter((match): match is RegExpExecArray => match !== null)
          // The totals row matches the same shape as an item row. Every real parser
          // has this problem and every real parser needs this line.
          .filter((match) => match[1] !== "Total")
          .map((match) => ({ description: match[1] ?? "", amount: money(match[2]) ?? 0 }));
        return {
          data: {
            invoiceNumber: required(capture(all, /^Invoice\s+(#\S+)$/), "invoiceNumber"),
            items,
          },
        };
      },
    }),
  );

  try {
    const data = await csvExtractor.extractData(
      { bytes: new TextEncoder().encode(csv), mimeType: "text/x-xy-csv" },
      z.object({
        invoiceNumber: z.string(),
        items: z.array(z.object({ description: z.string(), amount: z.number() })),
      }),
    );
    field("invoiceNumber", data.invoiceNumber);
    table(
      [
        { header: "description", width: 16 },
        { header: "amount", width: 10, right: true },
      ],
      data.items.map((item) => [item.description, amount(item.amount)]),
    );
    note(
      "`linesFromWords` did the work: two words at the same y became one line, so the\n" +
        "parser reads `Widget 42.00` and never has to know about coordinates. A real OCR\n" +
        "loader is this plus an engine.",
    );
  } finally {
    await csvExtractor.dispose();
  }

  // ── 4. A rasterizer ─────────────────────────────────────────────────────────

  step("4. a rasterizer, and the one thing it owes its caller");

  /**
   * A rasterizer takes bytes and returns page images. Its one real obligation is
   * `scale` — points-per-pixel — because without it a consumer cannot map a pixel box
   * from OCR back to a position in the PDF, and every geometry-based parser downstream
   * breaks silently.
   *
   * This one delegates to MuPDF and then re-reports the sizes it got, which is also how
   * you would write a rasterizer that crops, deskews or thresholds before handing the
   * pixels on.
   */
  // Typed as the interface, so the optional `dispose` is reachable.
  const inner: Rasterizer = new MuPdfRasterizer();
  const annotating = defineRasterizer({
    name: "annotating",
    formats: ["png", "jpeg"],
    async rasterize(document, options, ctx) {
      const rendered = await inner.rasterize(document, options, ctx);
      // The size a rasterizer claims and the size the bytes actually are should agree.
      // `imageSize` reads it from the header, which is why core exports it.
      return rendered.map((page) => {
        const measured = imageSize(page.bytes);
        ctx.logger.debug("rendered", {
          page: String(page.pageNumber),
          claimed: `${page.widthPx}x${page.heightPx}`,
          measured: `${measured?.widthPx}x${measured?.heightPx}`,
        });
        return page;
      });
    },
    dispose: () => inner.dispose?.() ?? Promise.resolve(),
  });

  const rendered = await annotating.rasterize(
    { bytes: new Uint8Array(await readFile(path)), mimeType: "application/pdf" },
    { dpi: 96, format: "png", pages: [1] },
    { signal: AbortSignal.timeout(60_000), logger: silentLogger },
  );
  const page = rendered[0];
  if (page !== undefined) {
    const measured = imageSize(page.bytes);
    field("page", page.pageNumber);
    field("format", page.format);
    field("claimed size", `${page.widthPx} x ${page.heightPx} px`);
    field("measured from bytes", `${measured?.widthPx} x ${measured?.heightPx} px`);
    field("scale (points per px)", page.scale.toFixed(4));
    field("agree", measured?.widthPx === page.widthPx ? "yes" : "NO");
  }
  await annotating.dispose?.();

  note(
    "A fifth plugin type — the CLASSIFIER — is example 10, and a sixth — the SPLITTER —\n" +
      "is example 11. Both are the same shape: a plain object, one method.\n\n" +
      "Every loader and rasterizer package in this repo runs a shared conformance suite\n" +
      "against its own class, which is what makes them interchangeable in fact rather\n" +
      "than in principle. Pointing it at YOUR loader is one call — see example 14.",
  );

  console.log("\n  Next: 06-fallback-routing-and-errors — nothing is silent.");
}

if (isMain(import.meta.url)) await run(main);
