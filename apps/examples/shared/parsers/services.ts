/**
 * A deterministic parser for the services-invoice layout.
 *
 * Lifted unchanged from what used to be `src/01-invoice.ts`. Example 05 derives this
 * one step by step, because it is the smaller of the two and the shape of a strategy is
 * easier to see when the regexes are not fighting for attention.
 *
 * `sammy-maystone-invoice`. A different vendor, a different template, the SAME contract:
 *
 *     Item Quantity Rate Amount
 *     Service A 12 $10.00 $120.00
 *     Description: Repair
 *     Notes: Replaced capacitor
 *     Parts: 1 x cap_a
 *     Tax: 0.2%
 *
 * Here an item is followed by up to four labelled detail lines, and tax is a labelled
 * percentage rather than a column.
 */

import { defineStrategy, type ExtractionStrategy } from "docture";
import type { LineItem } from "../contracts.js";
import { capture, lines, money, required } from "../text.js";

const SERVICES_HEAD = /^Item\s+Quantity\s+Rate\s+Amount$/;
const SERVICES_ITEM = /^(.+?)\s+(\d+(?:\.\d+)?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})$/;
const SERVICES_DETAIL = /^(Description|Notes|Parts|Tax):\s*(.+)$/;
const SERVICES_SUBTOTAL = /^Subtotal:\s*\$([\d,]+\.\d{2})$/;
const SERVICES_TAX = /^Tax\s*\([\d.]+%\):\s*\$([\d,]+\.\d{2})$/;
const SERVICES_TOTAL = /^Total:\s*\$([\d,]+\.\d{2})$/;

/** "Jan 1, 2022" is the only date format this template uses. */
export function longDate(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const parsed = new Date(`${raw} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function servicesInvoiceParser(): ExtractionStrategy {
  return defineStrategy({
    name: "services-invoice-parser",
    requires: ["TEXT_LAYER"],
    needsClassification: "none",

    async extract(ctx) {
      const all = lines(ctx.document);
      const headIndex = all.findIndex((line) => SERVICES_HEAD.test(line));
      if (headIndex === -1) throw new Error("no services-invoice item table found");

      const items: LineItem[] = [];
      let subtotal: number | null = null;
      let tax: number | null = null;
      let total: number | null = null;

      for (const line of all.slice(headIndex + 1)) {
        const item = SERVICES_ITEM.exec(line);
        if (item !== null) {
          items.push({
            code: null,
            description: (item[1] ?? "").trim(),
            notes: null,
            section: null,
            quantity: Number(item[2]),
            unit: null,
            unitPrice: money(item[3]) ?? 0,
            discountPercent: null,
            taxPercent: null,
            amount: money(item[4]) ?? 0,
          });
          continue;
        }

        const taxTotal = SERVICES_TAX.exec(line);
        if (taxTotal !== null) {
          tax = money(taxTotal[1]);
          continue;
        }
        const subtotalMatch = SERVICES_SUBTOTAL.exec(line);
        if (subtotalMatch !== null) {
          subtotal = money(subtotalMatch[1]);
          continue;
        }
        const totalMatch = SERVICES_TOTAL.exec(line);
        if (totalMatch !== null) {
          total = money(totalMatch[1]);
          continue;
        }

        // A labelled detail line belongs to the item above it. `Tax:` here is a
        // per-item percentage, unlike the `Tax (0%):` line that closes the invoice.
        const detail = SERVICES_DETAIL.exec(line);
        const last = items.at(-1);
        if (detail !== null && last !== undefined) {
          const [, label, value] = detail;
          if (label === "Tax") {
            last.taxPercent = Number((value ?? "").replace("%", ""));
          } else {
            const note = `${label}: ${value}`;
            last.notes = last.notes === null ? note : `${last.notes}; ${note}`;
          }
        }
      }

      if (items.length === 0) throw new Error("services-invoice table had no rows");

      return {
        data: {
          invoiceNumber: required(capture(all, /^#\s*(\S+)$/), "invoiceNumber"),
          invoiceDate: required(longDate(capture(all, /^Date:\s*(.+)$/)), "invoiceDate"),
          dueDate: longDate(capture(all, /Due Date:\s*(.+)$/)),
          reference: capture(all, /PO Number:\s*(\S+)/) ?? null,
          // Line 0 is the "INVOICE" title; the issuer is the line under it.
          vendor: required(all[1], "vendor"),
          customer: capture(all, /^(\S+ \S+)\s+\S+'s Store$/) ?? null,
          currency: "USD",
          lineItems: items,
          subtotal: required(subtotal, "subtotal"),
          tax: tax ?? 0,
          total: required(total, "total"),
        },
      };
    },
  });
}
