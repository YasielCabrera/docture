import { describe, expect, it } from "vitest";
import { silentLogger } from "docture";
import { describeLoaderConformance } from "docture/testing/conformance";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { PdfJsLoader } from "../../../src/loaders/pdfjs/index.js";

// The shared suite every loader package runs. Passing it is what makes PdfJsLoader
// interchangeable with MuPdfLoader rather than merely similarly shaped.
describeLoaderConformance({
  name: "PdfJsLoader",
  create: () => new PdfJsLoader(),
});

const ctx = { signal: new AbortController().signal, logger: silentLogger };

describe("PdfJsLoader — specifics", () => {
  it("recovers the invoice fields a schema would ask for", async () => {
    const pdf = await makeInvoicePdf({ seed: 101 });
    const document = await new PdfJsLoader().load(
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
    const pdf = await makeInvoicePdf({ seed: 102, lineItemCount: 3 });
    const document = await new PdfJsLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    const first = pdf.expected.lineItems[0]!;
    const row = document.pages
      .flatMap((p) => p.lines ?? [])
      .find((l) => l.text.includes(first.description));

    expect(row).toBeDefined();
    // Description, qty, unit price and amount all landed on the same line.
    expect(row!.text).toContain(String(first.quantity));
    expect(row!.spans.length).toBeGreaterThan(1);
  });

  it("puts the header near the top of the page, not the bottom", async () => {
    const pdf = await makeInvoicePdf({ seed: 103 });
    const document = await new PdfJsLoader().load(
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
    const pdf = await makeInvoicePdf({ seed: 104, textless: true });
    const document = await new PdfJsLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    expect(document.form).toBe("scanned");
    expect(document.text.trim()).toBe("");
  });

  it("honours maxPages", async () => {
    const pdf = await makeInvoicePdf({ seed: 105, lineItemCount: 45 });
    expect(pdf.pageCount).toBeGreaterThan(1);

    const document = await new PdfJsLoader({ maxPages: 1 }).load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );

    expect(document.pages).toHaveLength(1);
    expect(document.meta).toMatchObject({ pageCount: pdf.pageCount, pagesRead: 1 });
  });

  it("does not consume the caller's buffer, so a fallback loader still gets bytes", async () => {
    const pdf = await makeInvoicePdf({ seed: 106 });
    const raw = { bytes: pdf.bytes, mimeType: "application/pdf" };

    await new PdfJsLoader().load(raw, ctx);
    // pdf.js detaches whatever buffer it is handed; we pass it a copy.
    expect(raw.bytes.length).toBeGreaterThan(0);

    const second = await new PdfJsLoader().load(raw, ctx);
    expect(second.text).toContain(pdf.expected.invoiceNumber);
  });

  it("separates pages with a form feed", async () => {
    const pdf = await makeInvoicePdf({ seed: 107, lineItemCount: 45 });
    const document = await new PdfJsLoader().load(
      { bytes: pdf.bytes, mimeType: "application/pdf" },
      ctx,
    );
    expect(document.text).toContain("\f");
    expect(document.text.split("\f")).toHaveLength(document.pages.length);
  });

  it("fails with a useful message on bytes that are not a PDF", async () => {
    await expect(
      new PdfJsLoader().load({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" }, ctx),
    ).rejects.toThrow(/pdfjs could not open/i);
  });
});
