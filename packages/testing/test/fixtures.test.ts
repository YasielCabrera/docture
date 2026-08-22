import { describe, expect, it } from "vitest";
import { buildInvoiceData, formatMoney, makeInvoicePdf } from "../src/index.js";

describe("makeInvoicePdf", () => {
  it("produces a real PDF", async () => {
    const pdf = await makeInvoicePdf({ seed: 1 });
    expect(Buffer.from(pdf.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(1000);
  });

  it("is deterministic — the same seed gives the same ground truth", async () => {
    const a = await makeInvoicePdf({ seed: 42 });
    const b = await makeInvoicePdf({ seed: 42 });
    expect(a.expected).toEqual(b.expected);
  });

  it("varies with the seed", async () => {
    const a = await makeInvoicePdf({ seed: 1 });
    const b = await makeInvoicePdf({ seed: 2 });
    expect(a.expected.invoiceNumber).not.toBe(b.expected.invoiceNumber);
  });

  it("keeps its own arithmetic consistent", () => {
    const data = buildInvoiceData({ seed: 7, lineItemCount: 9 });

    const summed = data.lineItems.reduce((total, li) => total + li.amount, 0);
    expect(summed).toBeCloseTo(data.subtotal, 2);
    expect(data.tax).toBeCloseTo(data.subtotal * data.taxRate, 2);
    expect(data.total).toBeCloseTo(data.subtotal + data.tax, 2);

    for (const item of data.lineItems) {
      expect(item.amount).toBeCloseTo(item.quantity * item.unitPrice, 2);
    }
  });

  it("spills onto more pages as line items grow", async () => {
    const small = await makeInvoicePdf({ seed: 3, lineItemCount: 4 });
    const large = await makeInvoicePdf({ seed: 3, lineItemCount: 45 });
    expect(small.pageCount).toBe(1);
    expect(large.pageCount).toBeGreaterThan(1);
  });

  it("can produce a textless page to stand in for a scan", async () => {
    const scan = await makeInvoicePdf({ seed: 4, textless: true });
    expect(Buffer.from(scan.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    // The ground truth still exists; the document just does not show it as text.
    expect(scan.expected.invoiceNumber).toBeTruthy();
  });

  it("formats money the way the PDF renders it", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney(0.05)).toBe("0.05");
  });
});
