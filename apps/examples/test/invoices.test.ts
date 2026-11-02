import { readFile } from "node:fs/promises";
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { silentLogger } from "docture";
import { describe, expect, it } from "vitest";

const cases = [
  { file: "invoice.pdf", vendor: "Larkspur Sample Supply Co.", rows: 5, subtotal: 664.17, tax: 53.13, total: 717.3, rate: 0.08 },
  { file: "tax-invoice.pdf", vendor: "Larkfield Stationers", rows: 6, subtotal: 14702, tax: 2646.36, total: 17348.36, rate: 0.18 },
];
const amount = (text: string | undefined) => Number(text?.replaceAll(",", ""));

for (const loader of [new DocumentLoaderPdfJs(), new DocumentLoaderMuPdf()]) {
  describe(loader.name, () => {
    for (const invoice of cases) {
      it(`reads and reconciles every printed amount in ${invoice.file}`, async () => {
        const document = await loader.load({
          bytes: await readFile(new URL(`../accuracy-and-batch/${invoice.file}`, import.meta.url)),
          mimeType: "application/pdf",
        }, { signal: AbortSignal.timeout(30_000), logger: silentLogger });
        expect(document.pages).toHaveLength(1);
        expect(document.text).toContain(invoice.vendor);
        expect(document.text).toContain("INV-2026-0142");
        expect(document.text).toContain("CC0");
        const rows = document.pages.flatMap((page) => page.lines ?? []).flatMap(({ text }) => {
          if (!/^\d+\s/u.test(text.trim())) return [];
          const row = /(\d+)\s+[$₹]([\d,.]+)\s+[$₹]([\d,.]+)\s*$/u.exec(text);
          return row ? [{ quantity: Number(row[1]), price: amount(row[2]), total: amount(row[3]) }] : [];
        });
        expect(rows).toHaveLength(invoice.rows);
        for (const row of rows) expect(Math.round(row.quantity * row.price * 100)).toBe(Math.round(row.total * 100));
        expect(Math.round(rows.reduce((sum, row) => sum + row.total, 0) * 100)).toBe(Math.round(invoice.subtotal * 100));
        expect(amount(/Subtotal\s+[$₹]([\d,.]+)/iu.exec(document.text)?.[1])).toBe(invoice.subtotal);
        expect(amount(/(?:Sales Tax \(8%\)|GST at 18%)\s+[$₹]([\d,.]+)/iu.exec(document.text)?.[1])).toBe(invoice.tax);
        expect(amount(/Total Due\s+[$₹]([\d,.]+)/iu.exec(document.text)?.[1])).toBe(invoice.total);
        expect(Math.round(invoice.subtotal * invoice.rate * 100)).toBe(Math.round(invoice.tax * 100));
        expect(Math.round((invoice.subtotal + invoice.tax) * 100)).toBe(Math.round(invoice.total * 100));
      });
    }
  });
}
