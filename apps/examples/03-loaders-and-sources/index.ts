/**
 * Where the bytes come from, and who reads them.
 *
 *     pnpm --filter @docture/examples loaders
 *
 * Needs: `pnpm run fetch`. No API key.
 *
 * Read top to bottom:
 *
 *   1. TWO LIBRARIES, one document, same shape out — pdf.js and MuPDF
 *   2. A DOCUMENT THAT WAS NEVER A PDF — `DocumentLoaderData` on real text
 *   3. EVERY KIND OF SOURCE: a path, a URL, bytes, an ArrayBuffer, a RawDocument
 *   4. WHAT A LOAD FOUND — `DocumentFeatures`, and the digital/scanned verdict
 *   5. `pages` — read three of six
 *   6. NO LOADER FOR THIS — the two typed failures, and what they tell you
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DocumentLoaderData, NoEligibleLoaderError, UnsupportedSourceError, defineStrategy, inferForm, type DocumentLoader, loaderAccepts, silentLogger, sniffMimeType, type DocumentSource } from "docture";
import { Extractor, resolveSource } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
import { z } from "zod";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { checkingStatementParser } from "../shared/parsers/statement.js";
import { amount, field, heading, note, step, table } from "../shared/print.js";
import { isMain, requireDocuments, run } from "../shared/run.js";
import { documentOf, pathOf } from "../shared/documents.js";

async function main(): Promise<void> {
  const [invoicePath, orlenPath, statementPath, scanPath] = await requireDocuments(
    "invoice-odoo",
    "invoice-orlen",
    "statement",
    "scan-services",
  );

  heading("Loaders and sources");

  // ── 1. Two libraries, one document ────────────────────────────────────────────

  step("1. two libraries, one document, the same shape out");

  /**
   * Both of these implement `DocumentLoader`. Both are named after the library they
   * wrap, so swapping one for the other is swapping an import — there is no
   * `pdfTextLayer()` hiding a choice you did not make.
   *
   * The built-in loaders under `docture/loaders/*` run the same conformance suite
   * against their own classes. See example 14.
   */
  for (const loader of [new DocumentLoaderPdfJs(), new DocumentLoaderMuPdf()]) {
    const extractor = new Extractor().loadDocumentLoader(loader).loadStrategy(odooInvoiceParser());
    try {
      const result = await extractor.extract(invoicePath, Invoice);
      field(
        `via ${loader.name}`,
        `${result.data.lineItems.length} line items, total ${amount(result.data.total)}, ` +
          `${result.usage.wallMs} ms`,
      );
    } finally {
      await extractor.dispose();
    }
  }

  // ── 2. A document that was never a PDF ────────────────────────────────────────

  step("2. a document that was never a PDF");

  /**
   * `DocumentLoaderData` needs no optional engine. Text, Markdown, CSV and JSON
   * use TextDecoder; HTML and XHTML load syntax parsers for visible text.
   *
   * `invoice-orlen` is a real invoice from the same corpus that ships as `.txt`. No PDF
   * parser is involved in reading it — and `docture` on its own, with no loader
   * engine installed at all, can do this.
   */
  // Typed as the INTERFACE, not the class. `DocumentLoaderData.load` is declared with a
  // single parameter on the concrete class, so calling it with a `LoadContext` only
  // typechecks through `DocumentLoader`. Worth knowing if you ever call a loader directly
  // rather than through an `Extractor`, which is the normal way.
  const dataLoader: DocumentLoader = new DocumentLoaderData({
    // The default is the form feed `\f`, which is what this library uses to join pages
    // back together, so a round trip through `document.text` preserves page boundaries.
    pageDelimiter: "\f",
  });
  field("loader name", dataLoader.name);
  field(
    "capabilities",
    JSON.stringify({
      text: dataLoader.capabilities.text,
      geometry: dataLoader.capabilities.geometry,
      images: dataLoader.capabilities.images,
    }),
  );
  field("accepts text/plain", loaderAccepts(dataLoader, "text/plain"));
  field("accepts application/pdf", loaderAccepts(dataLoader, "application/pdf"));

  const orlenText = await readFile(orlenPath);
  const orlen = await dataLoader.load(
    { bytes: orlenText, mimeType: "text/plain", fileName: "Orlen.txt" },
    { signal: AbortSignal.timeout(10_000), logger: silentLogger },
  );
  field("pages", orlen.pages.length);
  field("form", orlen.form);
  field("first line", orlen.pages[0]?.text.split("\n").find((l) => l.trim() !== "")?.trim());
  note(
    "`geometry: false` on this loader, and that is honest rather than lazy: a text file\n" +
      "has no coordinates to report, and inventing US Letter would be a lie a geometry\n" +
      "consumer could act on. A strategy that requires GEOMETRY will not accept it.",
  );

  // ── 3. Every kind of source ───────────────────────────────────────────────────

  step("3. every kind of source");

  const bytes = new Uint8Array(await readFile(invoicePath));

  /**
   * `DocumentSource` is a union, and `resolveSource` is the one place it is
   * interpreted: a path or `file:` URL is read from disk, an `http(s)` URL is fetched,
   * bytes are used as-is, and a `LoadedSource` skips the load stage entirely because it
   * has already been read (example 13).
   */
  const sources: readonly (readonly [string, DocumentSource])[] = [
    ["a path string", invoicePath],
    ["a file: URL", pathToFileURL(invoicePath)],
    ["a Uint8Array", bytes],
    ["an ArrayBuffer", bytes.buffer.slice(0) as ArrayBuffer],
    ["a RawDocument", { bytes, mimeType: "application/pdf", fileName: "azure.pdf" }],
    ["an https: URL", documentOf("invoice-odoo").url],
  ];

  const rows: unknown[][] = [];
  for (const [label, source] of sources) {
    const raw = await resolveSource(source, AbortSignal.timeout(30_000));
    rows.push([label, raw.mimeType ?? "(none)", `${raw.bytes.length.toLocaleString()} bytes`]);
  }
  table(
    [
      { header: "source", width: 18 },
      { header: "resolved mimeType", width: 20 },
      { header: "size", width: 16, right: true },
    ],
    rows,
  );

  note(
    "Precedence for the media type: what the caller said → magic bytes → file extension\n" +
      "→ application/octet-stream. For an http(s) URL, `content-type` from the server IS\n" +
      "what the caller said — which is why the last row reads application/octet-stream:\n" +
      "raw.githubusercontent.com serves every file that way. A server that mislabels is a\n" +
      "real problem, and the fix is to say so yourself: pass a `RawDocument` with an\n" +
      "explicit `mimeType` and nothing has to guess.\n\n" +
      "`sniffMimeType` is the magic-bytes step, and it is public so you can pre-empt this:",
  );
  console.log("");
  field("sniff(the invoice)", sniffMimeType(bytes));
  field("sniff(the page image)", sniffMimeType(new Uint8Array(await readFile(scanPath))));
  field("sniff(the text file)", String(sniffMimeType(new Uint8Array(orlenText))));

  // ── 4. What a load found ──────────────────────────────────────────────────────

  step("4. what a load found");

  /**
   * `features` is what strategy eligibility is decided against, so a strategy that
   * cannot possibly work on this document never runs. It is on every result.
   */
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser(), checkingStatementParser());

  try {
    const invoiceResult = await extractor.extract(invoicePath, Invoice);
    const f = invoiceResult.features;
    table(
      [
        { header: "feature", width: 22 },
        { header: "the invoice", width: 18 },
      ],
      [
        ["mimeType", f.mimeType],
        ["pageCount", f.pageCount],
        ["textLength", f.textLength.toLocaleString()],
        ["hasTextLayer", f.hasTextLayer],
        ["hasGeometry", f.hasGeometry],
        ["hasRenderablePages", f.hasRenderablePages],
        ["form", f.form],
      ],
    );

    note(
      "`form` is the digital / scanned / mixed / unknown verdict, and it is derived from\n" +
        "per-page text length rather than asserted by the loader. `inferForm` is public,\n" +
        "so you can ask it directly:",
    );
    console.log("");
    field("inferForm([1200, 1100])", inferForm([1200, 1100]));
    field("inferForm([0, 0])", inferForm([0, 0]));
    field("inferForm([1200, 0])", inferForm([1200, 0]));
    field("inferForm([])", inferForm([]));

    // ── 5. `pages` — read three of six ──────────────────────────────────────────

    step("5. `pages` — read three of six");

    /**
     * The statement holds two accounts across six pages. `pages` restricts the run, so
     * a strategy with no business on pages 4 and 5 never sees them.
     *
     * This probe reports what it was handed rather than extracting anything, because
     * "which pages did the strategy actually get" is the thing being demonstrated and
     * a transaction count would not show it.
     */
    const probe = new Extractor().loadDocumentLoader(new DocumentLoaderPdfJs()).loadStrategy(
      defineStrategy({
        name: "page-probe",
        requires: ["TEXT_LAYER"],
        async extract(ctx) {
          return {
            data: {
              pagesSeen: ctx.document.pages.map((page) => page.pageNumber),
              chars: ctx.document.text.trim().length,
              // Page 4 is where the credit line starts. Did this run reach it?
              sawCreditLine: /READY RESERVE/.test(ctx.document.text),
            },
          };
        },
      }),
    );

    const Probe = z.object({
      pagesSeen: z.array(z.number()),
      chars: z.number(),
      sawCreditLine: z.boolean(),
    });

    try {
      const whole = await probe.extractData(statementPath, Probe);
      const part = await probe.extractData(statementPath, Probe, { pages: [1, 2, 3] });
      table(
        [
          { header: "run", width: 22 },
          { header: "pages the strategy saw", width: 24 },
          { header: "chars", width: 8, right: true },
          { header: "saw credit line", width: 15 },
        ],
        [
          ["no `pages` option", whole.pagesSeen.join(", "), whole.chars.toLocaleString(), whole.sawCreditLine],
          ["pages: [1, 2, 3]", part.pagesSeen.join(", "), part.chars.toLocaleString(), part.sawCreditLine],
        ],
      );
      note(
        "The file is read once either way — `pages` filters what the STRATEGY is handed,\n" +
          "it does not re-parse. That is the same mechanism `Process` uses to extract four\n" +
          "documents out of one bundle without paying to parse it four times (example 11).",
      );
    } finally {
      await probe.dispose();
    }

  } finally {
    await extractor.dispose();
  }

  // ── 6. No loader for this ─────────────────────────────────────────────────────

  step("6. no loader for this");

  /**
   * Two different failures, and they are worth telling apart.
   *
   * `NO_ELIGIBLE_LOADER` means the document arrived fine and nothing wired up will read
   * that media type — it names the gaps, so the fix is obvious. `UNSUPPORTED_SOURCE`
   * means the thing you passed was never a document at all.
   */
  const pdfOnly = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser());

  try {
    const outcome = await pdfOnly.safeExtract(pathOf("scan-services"), Invoice);
    if (!outcome.ok && outcome.error instanceof NoEligibleLoaderError) {
      field("error.code", outcome.error.code);
      field("message", outcome.error.message.split("\n")[0] ?? "");
      note("The fix is a loader that reads pixels. That is example 09.");
    }

    // A source that is not a source. The most ordinary mistake there is: an unset
    // variable, or a promise nobody awaited.
    const missing = await pdfOnly.safeExtract(undefined as unknown as DocumentSource, Invoice);
    if (!missing.ok && missing.error instanceof UnsupportedSourceError) {
      console.log("");
      field("error.code", missing.error.code);
      field("message", missing.error.message);
    }
  } finally {
    await pdfOnly.dispose();
  }

  console.log("\n  Next: 04-capabilities-and-composition — the wiring mistake that is a\n  compile error.");
}

if (isMain(import.meta.url)) await run(main);
