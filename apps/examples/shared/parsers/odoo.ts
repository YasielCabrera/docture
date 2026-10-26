/**
 * A deterministic parser for the Odoo invoice layout.
 *
 * Lifted unchanged from what used to be `src/01-invoice.ts`. It lives here rather than
 * inside an example because the shared regex would distract from the
 * lesson — example 05 is where a parser like this gets written and explained.
 *
 * `azure-interior-invoice`, as the text layer reports it:
 *
 *     Description Quantity Unit Price Disc.% Taxes Amount
 *     --- Non Food ---
 *     [17589684] Beeswax XL 1.00 kg 42.00 0.00 15.00% $ 42.00
 *     Acme beeswax
 *     [FURN_7777] Office Chair 1.00 Units 70.00 0.00 15.00% $ 70.00
 *     Subtotal $ 112.00
 *
 * Three things there are not obvious. Sections are rows, not columns. A description can
 * continue on the next line, so "Acme beeswax" belongs to the Beeswax row. And the tax
 * column is genuinely absent on some rows, which is why `taxPercent` is nullable rather
 * than defaulted to zero.
 */

import { defineStrategy, type ExtractionStrategy } from "docture";
import type { LineItem } from "../contracts.js";
import { capture, isoDate, lines, money, required } from "../text.js";

const ODOO_ITEM =
  /^(?:\[([^\]]+)\]|\*([^*]+)\*)\s+(.+?)\s+([\d,]+\.\d{2})\s+(\S+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+([\d.]+)%)?\s+\$\s*([\d,]+\.\d{2})$/;
const ODOO_SECTION = /^---\s*(.+?)\s*---$/;
const ODOO_HEAD = /^Description\s+Quantity/;
const ODOO_SUBTOTAL = /^Subtotal\s+\$\s*([\d,]+\.\d{2})$/;
const ODOO_TAX = /^Tax\s+[\d.]+%\s+on\s+\$\s*[\d,]+\.\d{2}\s+\$\s*([\d,]+\.\d{2})$/;
const ODOO_TOTAL = /^Total\s+\$\s*([\d,]+\.\d{2})$/;

export function odooInvoiceParser(): ExtractionStrategy {
  return defineStrategy({
    name: "odoo-invoice-parser",
    requires: ["TEXT_LAYER", "GEOMETRY"],
    needsClassification: "none",

    async extract(ctx) {
      const all = lines(ctx.document);
      const headIndex = all.findIndex((line) => ODOO_HEAD.test(line));
      // Not this layout. Throwing hands the document to the next strategy.
      if (headIndex === -1) throw new Error("no Odoo item table header found");

      const items: LineItem[] = [];
      let section: string | null = null;
      let subtotal: number | null = null;
      let tax = 0;
      let total: number | null = null;
      // A continuation line only counts if it sits DIRECTLY under its item. Without
      // this, the payment instructions further down the page get adopted as a note on
      // the last line item.
      let openItem = false;

      for (const line of all.slice(headIndex + 1)) {
        const sectionMatch = ODOO_SECTION.exec(line);
        if (sectionMatch !== null) {
          section = sectionMatch[1] ?? null;
          openItem = false;
          continue;
        }

        const item = ODOO_ITEM.exec(line);
        if (item !== null) {
          items.push({
            code: item[1] ?? item[2] ?? null,
            description: (item[3] ?? "").trim(),
            notes: null,
            section,
            quantity: money(item[4]) ?? 0,
            unit: item[5] ?? null,
            unitPrice: money(item[6]) ?? 0,
            discountPercent: money(item[7]),
            taxPercent: item[8] === undefined ? null : Number(item[8]),
            amount: money(item[9]) ?? 0,
          });
          openItem = true;
          continue;
        }

        const taxMatch = ODOO_TAX.exec(line);
        if (taxMatch !== null) {
          tax = money(taxMatch[1]) ?? 0;
          openItem = false;
          continue;
        }

        const totalMatch = ODOO_TOTAL.exec(line);
        if (totalMatch !== null) {
          total = money(totalMatch[1]);
          openItem = false;
          continue;
        }

        // Section subtotals and the invoice subtotal share a label. The last one
        // before the total is the invoice subtotal, so keep overwriting.
        const subtotalMatch = ODOO_SUBTOTAL.exec(line);
        if (subtotalMatch !== null) {
          if (total === null) subtotal = money(subtotalMatch[1]);
          openItem = false;
          continue;
        }

        const last = items.at(-1);
        if (openItem && last !== undefined && /^[A-Za-z]/.test(line)) {
          last.notes = last.notes === null ? line : `${last.notes} ${line}`;
        } else {
          openItem = false;
        }
      }

      if (items.length === 0) throw new Error("Odoo item table had no parseable rows");

      // The labels and their values sit on two separate lines, which is why this looks
      // for the label row and then reads the row under it.
      const labelIndex = all.findIndex((line) => /^Invoice Date:/.test(line));
      const dates = (labelIndex === -1 ? undefined : all[labelIndex + 1])?.split(/\s+/) ?? [];

      return {
        data: {
          invoiceNumber: required(capture(all, /^Invoice\s+(\S+\/\S+)$/), "invoiceNumber"),
          invoiceDate: required(isoDate(dates[0]), "invoiceDate"),
          dueDate: isoDate(dates[1]),
          reference: dates[2] ?? null,
          // The issuing company is the top-left letterhead, above the bill-to block.
          vendor: required(all[1], "vendor"),
          customer: all[5] ?? null,
          currency: "USD",
          lineItems: items,
          subtotal: required(subtotal, "subtotal"),
          tax,
          total: required(total, "total"),
        },
      };
    },
  });
}
