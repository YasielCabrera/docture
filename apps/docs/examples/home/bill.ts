import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import type { EvalCase, ExtractContext, ExtractOutput } from "@docture/eval";
import { defineTemplate, drawTable, locales } from "@docture/synthetic";
import { z } from "zod";

export const Bill = z.object({
  accountNumber: z.string(),
  customerName: z.string(),
  usage: z.array(z.object({ description: z.string(), kwh: z.number().int(), rateCents: z.number().int(), amountCents: z.number().int() })).min(1),
  amountDueCents: z.number().int(),
});
export type Bill = z.infer<typeof Bill>;

export const BillTotals = Bill.pick({ accountNumber: true, amountDueCents: true });

export function totals(bill: Bill): Bill {
  const usage = bill.usage.map((line) => ({ ...line, amountCents: line.kwh * line.rateCents }));
  return { ...bill, usage, amountDueCents: usage.reduce((sum, line) => sum + line.amountCents, 0) };
}

export const compact = defineTemplate<Bill>()({
  key: "compact-us",
  family: "utility-bill",
  page: { size: { width: 612, height: 792 }, margin: 40 },
  locale: locales["en-US"],
  printed: {
    accountNumber: true,
    customerName: true,
    usage: { items: { description: true, kwh: true, rateCents: false, amountCents: true } },
    amountDueCents: true,
  },
  draw(page, bill, f) {
    page.text("BRIGHTLINE ENERGY", { x: 40, y: 40, size: 16, font: "bold" });
    page.field("customerName", bill.customerName, { x: 40, y: 80 });
    page.text("Account number", { x: 360, y: 80, size: 9 });
    page.field("accountNumber", bill.accountNumber, { x: 572, y: 80, size: 9, align: "right" });
    const y = drawTable(page, {
      path: "usage", items: bill.usage, x: 40, y: 130, bottom: 752, continueAt: 40, reserveAfter: 30,
      style: { size: 9 }, headerStyle: { font: "bold" },
      columns: [
        { header: "Charge", width: 320, key: "description", text: (line) => line.description },
        { header: "kWh", width: 90, key: "kwh", align: "right", text: (line) => f.number(line.kwh) },
        { header: "Amount", width: 122, key: "amountCents", align: "right", text: (line) => f.money(line.amountCents) },
      ],
    });
    page.text("Amount due", { x: 360, y: y + 10, font: "bold" });
    page.field("amountDueCents", f.money(bill.amountDueCents), { x: 572, y: y + 10, font: "bold", align: "right" });
  },
});

const loader = new DocumentLoaderPdfJs();

export async function readBill(item: EvalCase<unknown>, context: ExtractContext): Promise<ExtractOutput<unknown>> {
  const document = item.documents[0];
  if (document === undefined) throw new Error(`${item.id} has no document`);
  const loaded = await loader.load({ bytes: await document.bytes(), mimeType: document.mimeType }, { signal: context.signal, logger: silentLogger });
  const text = loaded.pages.map((page) => page.text).join("\n");
  const due = /Amount due \$([\d,]+)\.(\d\d)/u.exec(text);
  return {
    raw: {
      accountNumber: /Account number (\d{12})/u.exec(text)?.[1] ?? null,
      amountDueCents: due === null ? null : Number(`${due[1]?.replace(/,/gu, "")}${due[2]}`),
    },
  };
}
