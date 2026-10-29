import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { defineEval, exact, number } from "@docture/eval";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { defineModel, defineTemplate, drawTable, gen, locales, prints, scenario, sumOf, validLuhn } from "@docture/synthetic";
import { digital, scan, writeCorpus } from "@docture/synthetic/node";
import { z } from "zod";

const Bill = z.object({
  accountNumber: z.string(),
  customerName: z.string(),
  tariff: z.enum(["standard", "green", "night-saver"]),
  usage: z.array(z.object({ description: z.string(), kwh: z.number().int(), rateCents: z.number().int(), amountCents: z.number().int() })).min(1),
  previousBalanceCents: z.number().int(),
  amountDueCents: z.number().int(),
});
type Bill = z.infer<typeof Bill>;

const model = defineModel(Bill, {
  fields: {
    accountNumber: gen.luhn("71", 12),
    customerName: gen.pick(["Dana Whitfield", "Kenji Okafor", "Ruth Ellingsen"]),
    usage: gen.array({ length: [2, 5] }),
    "usage[].description": gen.pick(["Energy charge", "Delivery charge", "Grid fee"]),
    "usage[].kwh": gen.int(20, 600),
    "usage[].rateCents": gen.int(12, 45),
    previousBalanceCents: gen.value(0),
  },
  derive(bill) {
    const usage = bill.usage.map((line) => ({ ...line, amountCents: line.kwh * line.rateCents }));
    const charges = usage.reduce((sum, line) => sum + line.amountCents, 0);
    return { ...bill, usage, amountDueCents: bill.previousBalanceCents + charges };
  },
  constraints: [validLuhn("accountNumber")],
});

const credit = scenario<Bill>({
  name: "credit-balance",
  fields: { previousBalanceCents: gen.int(-40_000, -15_000) },
  expect: (bill) => bill.previousBalanceCents < 0 || "the previous balance is not a credit",
});

const compact = defineTemplate<Bill>()({
  key: "compact-us",
  family: "utility-bill",
  page: { size: { width: 612, height: 792 }, margin: 40 },
  locale: locales["en-US"],
  printed: {
    accountNumber: true,
    customerName: true,
    tariff: prints((tariff: Bill["tariff"]) => (tariff === "night-saver" ? "Time of use" : "Flat rate")),
    usage: { items: { description: true, kwh: true, rateCents: false, amountCents: true } },
    previousBalanceCents: false,
    amountDueCents: true,
  },
  draw(page, bill, f) {
    page.text("BRIGHTLINE ENERGY", { x: 40, y: 40, size: 16, font: "bold" });
    page.field("customerName", bill.customerName, { x: 40, y: 80 });
    page.text("Account number", { x: 360, y: 80, size: 9 });
    page.field("accountNumber", bill.accountNumber, { x: 572, y: 80, size: 9, align: "right" });
    page.text("Rate plan", { x: 360, y: 94, size: 9 });
    page.field("tariff", bill.tariff === "night-saver" ? "Time of use" : "Flat rate", { x: 572, y: 94, size: 9, align: "right" });
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

const report = await writeCorpus(await mkdtemp(join(tmpdir(), "synthetic-corpus-")), {
  model,
  templates: [compact],
  seeds: [1],
  scenarios: [credit],
  renditions: [digital(), scan({ severity: 0.4, dpi: 150 })],
  createdAt: "2025-11-01T00:00:00Z",
});

const Scored = z.object({ accountNumber: z.string().nullable(), amountDueCents: z.number().int().nullable() });
const loader = new DocumentLoaderPdfJs();
const result = await runEval({
  dataset: jsonlDataset(report.manifest, { toExpected: (json) => Scored.parse(json) }),
  spec: defineEval(Scored, { fields: { accountNumber: exact(), amountDueCents: number() } }),
  slices: { rendition: "tags.rendition" },
  experiments: {
    id: "text-layer",
    async extract(item, context) {
      const document = item.documents[0];
      if (document === undefined) throw new Error(`${item.id} has no document`);
      const loaded = await loader.load({ bytes: await document.bytes(), mimeType: document.mimeType }, { signal: context.signal, logger: silentLogger });
      const text = loaded.pages.map((page) => page.text).join("\n");
      const due = /Amount due (-?)\$([\d,]+)\.(\d\d)/u.exec(text);
      return {
        raw: {
          accountNumber: /Account number (\d{12})/u.exec(text)?.[1] ?? null,
          amountDueCents: due === null ? null : (due[1] === "-" ? -1 : 1) * Number(`${due[2]?.replace(/,/gu, "")}${due[3]}`),
        },
      };
    },
  },
});

const slices = result.summary["text-layer"]?.slices["rendition"] ?? {};
console.log(`${report.written} cases, digital F1 ${slices["digital"]?.metrics["f1"]}, scan F1 ${slices["scan"]?.metrics["f1"]}`);
