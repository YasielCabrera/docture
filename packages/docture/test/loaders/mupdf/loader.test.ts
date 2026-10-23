import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { silentLogger, type Logger } from "docture";
import { describeLoaderConformance } from "docture/testing/conformance";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { MuPdfLoader } from "../../../src/loaders/mupdf/index.js";

// The shared suite every loader package runs. Passing the same suite as PdfJsLoader is
// what makes the two interchangeable rather than merely similarly shaped.
describeLoaderConformance({
  name: "MuPdfLoader",
  create: () => new MuPdfLoader(),
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };

/** A logger that keeps what it was told, so the MuPDF log bridge can be asserted on. */
function recordingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (msg, fields) => warnings.push(`${msg} ${JSON.stringify(fields ?? {})}`),
    error: () => {},
    child: () => logger,
  };
  return { logger, warnings };
}

/** A one-page encrypted PDF. */
function makeEncryptedPdf(userPassword: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", compress: false, userPassword });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.font("Helvetica").fontSize(12).text("Locked: INV-2026-9999", 50, 50);
    doc.end();
  });
}

describe("MuPdfLoader — specifics", () => {
  it("recovers the invoice fields a schema would ask for", async () => {
    const pdf = await makeInvoicePdf({ seed: 301 });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    expect(document.text).toContain(pdf.expected.invoiceNumber);
    expect(document.text).toContain(pdf.expected.issuedAt);
    expect(document.text).toContain(pdf.expected.buyerName);
    for (const item of pdf.expected.lineItems) {
      expect(document.text).toContain(item.description);
    }
  });

  it("groups a row's cells into one line, so a table parser can read across", async () => {
    // MuPDF reports each cell as its own text run — four "lines" for one visual row — so
    // this is the assertion that the run-to-row regrouping actually happened, and that a
    // table parser written against PdfJsLoader reads MuPdfLoader unchanged.
    const pdf = await makeInvoicePdf({ seed: 302, lineItemCount: 3 });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    const first = pdf.expected.lineItems[0]!;
    const row = document.pages
      .flatMap((p) => p.lines ?? [])
      .find((l) => l.text.includes(first.description));

    expect(row).toBeDefined();
    expect(row!.text).toContain(String(first.quantity));
    expect(row!.spans.length).toBeGreaterThan(1);
  });

  it("puts the header near the top of the page, not the bottom", async () => {
    const pdf = await makeInvoicePdf({ seed: 303 });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    const page = document.pages[0]!;
    const heading = page.lines?.find((l) => l.text.includes("INVOICE"));
    expect(heading).toBeDefined();
    // Top-left origin: the title sits in the first tenth of an A4 page.
    expect(heading!.y).toBeLessThan(page.height * 0.1);
  });

  it("reports a textless PDF as scanned instead of inventing content", async () => {
    const pdf = await makeInvoicePdf({ seed: 304, textless: true });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    expect(document.form).toBe("scanned");
    expect(document.text.trim()).toBe("");
  });

  it("honours maxPages", async () => {
    const pdf = await makeInvoicePdf({ seed: 305, lineItemCount: 45 });
    expect(pdf.pageCount).toBeGreaterThan(1);

    const document = await new MuPdfLoader({ maxPages: 1 }).load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    expect(document.pages).toHaveLength(1);
    expect(document.meta).toMatchObject({ pageCount: pdf.pageCount, pagesRead: 1 });
  });

  it("does not consume the caller's buffer, so a fallback loader still gets bytes", async () => {
    const pdf = await makeInvoicePdf({ seed: 306 });
    const raw = { bytes: pdf.bytes, mimeType: "application/pdf" };

    await new MuPdfLoader().load(raw, ctx);
    // MuPDF copies into its own WASM heap rather than detaching the caller's buffer the
    // way pdf.js does — so unlike the pdf.js loader, this one needs no defensive copy.
    expect(raw.bytes.length).toBeGreaterThan(0);

    const second = await new MuPdfLoader().load(raw, ctx);
    expect(second.text).toContain(pdf.expected.invoiceNumber);
  });

  it("separates pages with a form feed", async () => {
    const pdf = await makeInvoicePdf({ seed: 307, lineItemCount: 45 });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );
    expect(document.text).toContain("\f");
    expect(document.text.split("\f")).toHaveLength(document.pages.length);
  });

  it("fails with a useful message on bytes that are not a PDF", async () => {
    await expect(
      new MuPdfLoader().load({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/mupdf could not open/i);
  });

  it("routes MuPDF's own diagnostics into ctx.logger rather than stderr", async () => {
    // MuPDF reports through a global log hook whose default writes to stderr; malformed
    // bytes make it say "cannot find version marker" and "repairing PDF document". A
    // library that was handed silentLogger must stay silent, so the hook is bridged.
    const { logger, warnings } = recordingLogger();

    await expect(
      new MuPdfLoader().load(
        { bytes: new Uint8Array([1, 2, 3, 4, 5]), mimeType: "application/pdf" },
        { signal: ctx.signal, logger },
      ),
    ).rejects.toThrow();

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join("\n")).toMatch(/version marker|xref|repair/i);
  });

  it("says so plainly when a document is encrypted and no password was given", async () => {
    const bytes = await makeEncryptedPdf("hunter2");

    await expect(
      new MuPdfLoader().load({ bytes, mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/encrypted and no `password` was given/i);
  });

  it("rejects a wrong password, and accepts the right one", async () => {
    const bytes = await makeEncryptedPdf("hunter2");

    await expect(
      new MuPdfLoader({ password: "wrong" }).load({ bytes, mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/password.+rejected/i);

    const document = await new MuPdfLoader({ password: "hunter2" }).load(
      { bytes, mimeType: "application/pdf" },
      ctx,
    );
    expect(document.text).toContain("INV-2026-9999");
  });

  it("honours a signal aborted while the WASM engine was still loading", async () => {
    // The window the per-page check exists for. `load` runs synchronously as far as
    // `await loadMuPdf()`, so aborting here lands after the entry check has already
    // passed and before the first page is read — and reading must not start anyway.
    const pdf = await makeInvoicePdf({ seed: 308, lineItemCount: 45 });
    const controller = new AbortController();

    const pending = new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      { signal: controller.signal, logger: silentLogger },
    );
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("agrees with PdfJsLoader's coordinate convention on the same page", async () => {
    // Not a comparison against pdf.js (that would need the dependency) but against the
    // convention both must satisfy: PDF points, top-left origin, y down, sorted.
    const pdf = await makeInvoicePdf({ seed: 309 });
    const document = await new MuPdfLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    const page = document.pages[0]!;
    // A4 in points.
    expect(page.width).toBeCloseTo(595.28, 0);
    expect(page.height).toBeCloseTo(841.89, 0);

    const total = page.lines?.find((l) => l.text.includes("TOTAL"));
    const heading = page.lines?.find((l) => l.text.includes("INVOICE"));
    expect(total).toBeDefined();
    expect(heading).toBeDefined();
    // The total is below the heading, which is only true with y growing downward.
    expect(total!.y).toBeGreaterThan(heading!.y);
  });
});
