/**
 * Generate a labeled corpus from a schema, then score a real processor on it.
 *
 * Lesson: `@docture/synthetic` turns your extraction schema into documents whose ground
 * truth is correct by construction: the value of every printed field, and the page and
 * box where it is printed. `writeCorpus` writes them as a manifest that `@docture/eval`
 * scores, so a processor gets a number per template and per rendition with no labeling.
 *
 *   pnpm --filter @docture/examples synthetic
 *
 * Needs: nothing. No API key and no download. Engines: pdfkit, pdfjs-dist,
 * @napi-rs/canvas and sharp.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger, type LayoutBox } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { date, defineEval, exact, number, type EvalExtractor, type EvalResult, type FieldEvidence } from "@docture/eval";
import { groundingSection } from "@docture/eval/grounding";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import {
  before,
  constraint,
  defineModel,
  defineTemplate,
  drawTable,
  gen,
  locales,
  prints,
  scenario,
  sumOf,
  validLuhn,
  type ConcretePath,
  type Surface,
} from "@docture/synthetic";
import { digital, photo, scan, writeCorpus, type CorpusReport } from "@docture/synthetic/node";
import { z } from "zod";
import { field, heading, note, step, table } from "../shared/print.js";
import { isMain, run } from "../shared/run.js";

// ── 1. The schema ────────────────────────────────────────────────────────────────
//
// The same Zod schema an extractor would use. Nothing in it is synthetic-specific.

export const UtilityBill = z.object({
  accountNumber: z.string().describe("12 digits, the last a Luhn check digit"),
  customerName: z.string(),
  serviceAddress: z.object({ street: z.string(), postalCode: z.string(), city: z.string() }),
  servicePeriod: z.object({ from: z.string(), to: z.string() }),
  meter: z.object({ id: z.string(), previousReading: z.number().int(), currentReading: z.number().int() }),
  tariff: z.enum(["standard", "green", "night-saver"]),
  usage: z.array(z.object({ description: z.string(), kwh: z.number().int(), rateCents: z.number().int(), amountCents: z.number().int() })).min(1),
  previousBalanceCents: z.number().int().describe("Negative when the customer has a credit"),
  currentChargesCents: z.number().int(),
  amountDueCents: z.number().int(),
  dueDate: z.string(),
});
export type UtilityBill = z.infer<typeof UtilityBill>;

// ── 2. The model ─────────────────────────────────────────────────────────────────
//
// Generators per position, keyed by pattern. Every draw comes from a stream keyed by the
// seed and the field's path, so adding a field never changes the values of the others.
// `derive` recomputes every total from its inputs; the constraints then check them.

const COMPONENTS = ["Energy charge", "Delivery charge", "Peak usage", "Off-peak usage", "Grid fee", "Renewable levy", "Metering"];

export const billModel = defineModel(UtilityBill, {
  fields: {
    accountNumber: gen.luhn("71", 12),
    customerName: gen.pick(["Dana Whitfield", "Jörg Bäumer", "Amélie Roux", "Kenji Okafor", "Ruth Ellingsen"]),
    "serviceAddress.street": gen.pick(["14 Larch Lane", "Mühlenweg 3", "220 Harbor Road", "Kastanienallee 71"]),
    "serviceAddress.postalCode": gen.pattern("#####"),
    "serviceAddress.city": gen.pick(["Springfield", "Nordheim", "Riverton", "Lindau"]),
    "servicePeriod.from": gen.date({ from: "2025-01-01", to: "2025-10-31" }),
    "servicePeriod.to": gen.dateAfter("servicePeriod.from", { days: [28, 31] }),
    dueDate: gen.dateAfter("servicePeriod.to", { days: [14, 21] }),
    "meter.id": gen.pattern("M-#######"),
    "meter.previousReading": gen.int(10_000, 80_000),
    usage: gen.array({ length: [2, 5] }),
    "usage[].description": gen.pick(COMPONENTS),
    "usage[].kwh": gen.int(20, 600),
    "usage[].rateCents": gen.int(12, 45),
    previousBalanceCents: gen.from(({ stream }) => (stream.chance(0.7) ? 0 : stream.int(500, 9_000))),
  },
  derive(bill) {
    const usage = bill.usage.map((line) => ({ ...line, amountCents: line.kwh * line.rateCents }));
    const kwh = usage.reduce((sum, line) => sum + line.kwh, 0);
    const currentChargesCents = usage.reduce((sum, line) => sum + line.amountCents, 0);
    return {
      ...bill,
      usage,
      meter: { ...bill.meter, currentReading: bill.meter.previousReading + kwh },
      currentChargesCents,
      amountDueCents: bill.previousBalanceCents + currentChargesCents,
    };
  },
  constraints: [
    validLuhn("accountNumber"),
    sumOf("usage[].amountCents", "currentChargesCents"),
    before("servicePeriod.from", "servicePeriod.to"),
    before("servicePeriod.to", "dueDate"),
    constraint<UtilityBill>("meter delta", (bill) =>
      bill.meter.currentReading - bill.meter.previousReading === bill.usage.reduce((sum, line) => sum + line.kwh, 0)
        ? undefined
        : "the meter delta differs from the billed kWh",
    ),
  ],
});

// Scenarios vary the model without breaking its invariants: `derive` and the constraints
// run again, and `expect` states what the scenario promises.
export const manyLines = scenario<UtilityBill>({ name: "many-lines", tags: ["pagination"], fields: { usage: gen.array({ length: [40, 55] }) } });
export const creditBalance = scenario<UtilityBill>({
  name: "credit-balance",
  tags: ["negative-total"],
  fields: { previousBalanceCents: gen.int(-40_000, -15_000) },
  expect: (bill) => bill.previousBalanceCents < 0 || "the previous balance is not a credit",
});

// ── 3. Two templates ─────────────────────────────────────────────────────────────
//
// `printed` must name every schema field, so a new field fails to compile until each
// template decides. It is the honest answer to "what can a reader recover from this page":
// the US bill never shows the meter id, the German bill never shows the due date (it is
// paid by direct debit), and both print the tariff as a lossy plan name.

const groupedAccount = (digits: string): string => digits.replace(/(\d{4})(?=\d)/gu, "$1 ");

export const compactUs = defineTemplate<UtilityBill>()({
  key: "compact-us",
  family: "utility-bill",
  tags: { layout: "one-column" },
  page: { size: { width: 612, height: 792 }, margin: 40 },
  locale: locales["en-US"],
  printed: {
    accountNumber: true,
    customerName: true,
    serviceAddress: { street: true, postalCode: true, city: true },
    servicePeriod: { from: true, to: true },
    meter: { id: false, previousReading: true, currentReading: true },
    tariff: prints((tariff: UtilityBill["tariff"]) => (tariff === "night-saver" ? "Time of use" : "Flat rate")),
    usage: { items: { description: true, kwh: true, rateCents: true, amountCents: true } },
    previousBalanceCents: true,
    currentChargesCents: true,
    amountDueCents: true,
    dueDate: true,
  },
  draw(page, bill, f) {
    const right = 572;
    page.text("BRIGHTLINE ENERGY", { x: 40, y: 40, size: 16, font: "bold" });
    page.text("Electricity statement", { x: 40, y: 60, size: 9 });
    page.field("customerName", bill.customerName, { x: 40, y: 92, size: 11, font: "bold" });
    page.field("serviceAddress.street", bill.serviceAddress.street, { x: 40, y: 107 });
    page.field("serviceAddress.city", bill.serviceAddress.city, { x: 40, y: 120 });
    page.field("serviceAddress.postalCode", bill.serviceAddress.postalCode, { x: 40 + page.measure(`${bill.serviceAddress.city} `).width, y: 120 });

    const rows: [string, ConcretePath<UtilityBill>, string][] = [
      ["Account number", "accountNumber", groupedAccount(bill.accountNumber)],
      ["Service from", "servicePeriod.from", f.date(bill.servicePeriod.from)],
      ["Service to", "servicePeriod.to", f.date(bill.servicePeriod.to)],
      ["Rate plan", "tariff", bill.tariff === "night-saver" ? "Time of use" : "Flat rate"],
      ["Due date", "dueDate", f.date(bill.dueDate)],
    ];
    rows.forEach(([label, path, text], index) => {
      page.text(label, { x: 380, y: 92 + index * 14, size: 9 });
      page.field(path, text, { x: right, y: 92 + index * 14, size: 9, align: "right" });
    });
    page.text("Meter reading, previous", { x: 40, y: 170, size: 9 });
    page.field("meter.previousReading", f.number(bill.meter.previousReading), { x: 200, y: 170, size: 9, align: "right" });
    page.text("current", { x: 220, y: 170, size: 9 });
    page.field("meter.currentReading", f.number(bill.meter.currentReading), { x: 320, y: 170, size: 9, align: "right" });

    let y = drawTable(page, {
      path: "usage",
      items: bill.usage,
      x: 40,
      y: 200,
      bottom: 752,
      continueAt: 40,
      reserveAfter: 60,
      style: { size: 9 },
      headerStyle: { font: "bold" },
      columns: [
        { header: "Charge", width: 260, key: "description", text: (line) => line.description },
        { header: "kWh", width: 80, key: "kwh", align: "right", text: (line) => f.number(line.kwh) },
        { header: "Rate", width: 80, key: "rateCents", align: "right", text: (line) => f.money(line.rateCents) },
        { header: "Amount", width: 112, key: "amountCents", align: "right", text: (line) => f.money(line.amountCents) },
      ],
    });
    y += 10;
    for (const [label, path, cents] of [
      ["Previous balance", "previousBalanceCents", bill.previousBalanceCents],
      ["Current charges", "currentChargesCents", bill.currentChargesCents],
      ["Amount due", "amountDueCents", bill.amountDueCents],
    ] as const) {
      const style = path === "amountDueCents" ? { size: 11, font: "bold" } : { size: 10 };
      page.text(label, { x: 380, y, ...style });
      page.field(path, f.money(cents), { x: right, y, align: "right", ...style });
      y += 15;
    }
  },
});

const GERMAN: Readonly<Record<string, string>> = {
  "Energy charge": "Arbeitspreis",
  "Delivery charge": "Lieferentgelt",
  "Peak usage": "Hochtarif",
  "Off-peak usage": "Niedertarif",
  "Grid fee": "Netzentgelt",
  "Renewable levy": "Ökostromumlage",
  Metering: "Messstellenbetrieb",
};
const germanTariff = (tariff: UtilityBill["tariff"]): string => (tariff === "green" ? "Ökostrom" : "Grundversorgung");

/** A label in the left column and its value in the right one, one row of the German header. */
function pair(page: Surface<UtilityBill>, y: number, label: string, path: ConcretePath<UtilityBill>, text: string): void {
  page.text(label, { x: 320, y, size: 9 });
  page.field(path, text, { x: 430, y, size: 9 });
}

export const zweispaltigDe = defineTemplate<UtilityBill>()({
  key: "zweispaltig-de",
  family: "utility-bill",
  tags: { layout: "two-column" },
  locale: locales["de-DE"],
  printed: {
    accountNumber: true,
    customerName: true,
    serviceAddress: { street: true, postalCode: true, city: true },
    servicePeriod: { from: true, to: true },
    meter: { id: true, previousReading: true, currentReading: true },
    tariff: prints(germanTariff),
    // The page shows the German name, so that is what a reader can recover.
    usage: { items: { description: prints((description: string) => GERMAN[description] ?? description), kwh: true, rateCents: true, amountCents: true } },
    previousBalanceCents: true,
    currentChargesCents: true,
    amountDueCents: true,
    dueDate: false,
  },
  draw(page, bill, f) {
    page.text("Stadtwerke Nordheim", { x: 50, y: 50, size: 15, font: "bold" });
    page.text("Stromrechnung", { x: 320, y: 50, size: 15 });
    page.field("customerName", bill.customerName, { x: 50, y: 110, size: 10 });
    page.field("serviceAddress.street", bill.serviceAddress.street, { x: 50, y: 124, size: 10 });
    page.field("serviceAddress.postalCode", bill.serviceAddress.postalCode, { x: 50, y: 138, size: 10 });
    page.field("serviceAddress.city", bill.serviceAddress.city, { x: 50 + page.measure(`${bill.serviceAddress.postalCode} `, { size: 10 }).width, y: 138, size: 10 });

    pair(page, 110, "Kundennummer", "accountNumber", bill.accountNumber);
    pair(page, 124, "Zählernummer", "meter.id", bill.meter.id);
    pair(page, 138, "Tarif", "tariff", germanTariff(bill.tariff));
    pair(page, 152, "Zeitraum vom", "servicePeriod.from", f.date(bill.servicePeriod.from));
    pair(page, 166, "bis", "servicePeriod.to", f.date(bill.servicePeriod.to));
    page.text("Zählerstand alt", { x: 50, y: 190, size: 9 });
    page.field("meter.previousReading", f.number(bill.meter.previousReading), { x: 140, y: 190, size: 9 });
    page.text("Zählerstand neu", { x: 320, y: 190, size: 9 });
    page.field("meter.currentReading", f.number(bill.meter.currentReading), { x: 430, y: 190, size: 9 });

    let y = drawTable(page, {
      path: "usage",
      items: bill.usage,
      x: 50,
      y: 220,
      bottom: page.size.height - 60,
      continueAt: 60,
      reserveAfter: 90,
      style: { size: 9 },
      headerStyle: { font: "bold" },
      columns: [
        { header: "Position", width: 215, key: "description", text: (line) => GERMAN[line.description] ?? line.description },
        { header: "Verbrauch kWh", width: 90, key: "kwh", align: "right", text: (line) => f.number(line.kwh) },
        { header: "ct/kWh", width: 70, key: "rateCents", align: "right", text: (line) => f.number(line.rateCents) },
        { header: "Betrag", width: 120, key: "amountCents", align: "right", text: (line) => f.money(line.amountCents) },
      ],
    });
    y += 12;
    for (const [label, path, cents] of [
      [bill.previousBalanceCents < 0 ? "Guthaben Vorperiode" : "Saldo Vorperiode", "previousBalanceCents", bill.previousBalanceCents],
      ["Verbrauchskosten", "currentChargesCents", bill.currentChargesCents],
      ["Rechnungsbetrag", "amountDueCents", bill.amountDueCents],
    ] as const) {
      page.text(label, { x: 320, y, size: 10, ...(path === "amountDueCents" ? { font: "bold" } : {}) });
      page.field(path, f.money(cents), { x: 545, y, size: 10, align: "right", ...(path === "amountDueCents" ? { font: "bold" } : {}) });
      y += 15;
    }
    page.text("Der Rechnungsbetrag wird per Lastschrift eingezogen.", { x: 50, y: y + 10, size: 9 });
  },
});

// ── 4. A real processor: the PDF text layer and a handful of regexes ─────────────────
//
// What is being measured. It reads five fields from either layout, and reports where it
// found each one so grounding can check it against the synthetic boxes. A scan has no
// text layer, so this processor should fail on every scan and photo rendition.

export const ScoredBill = z.object({
  accountNumber: z.string().nullable(),
  servicePeriod: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  currentChargesCents: z.number().int().nullable(),
  amountDueCents: z.number().int().nullable(),
});
export type ScoredBill = z.infer<typeof ScoredBill>;

export const billSpec = defineEval(ScoredBill, {
  fields: {
    accountNumber: { compare: exact(), critical: true },
    "servicePeriod.from": date(),
    "servicePeriod.to": date(),
    currentChargesCents: number(),
    amountDueCents: number(),
  },
});

/** The scored fields of a bill's ground truth. Zod drops the other keys. */
export const scoredPart = (json: unknown): ScoredBill => ScoredBill.parse(json);

const isoOf = (text: string): string => {
  const us = /^(\d\d)\/(\d\d)\/(\d{4})$/u.exec(text);
  const de = /^(\d\d)\.(\d\d)\.(\d{4})$/u.exec(text);
  return us !== null ? `${us[3]}-${us[1]}-${us[2]}` : de !== null ? `${de[3]}-${de[2]}-${de[1]}` : text;
};
const centsOf = (text: string): number => Math.round(Number(text.replace(/[^\d,.-]/gu, "").replace(/[.,](?=\d{3}\b)/gu, "").replace(",", ".")) * 100);

/** `label value` patterns, one line each. The value is the first capture group. */
const PATTERNS: readonly (readonly [path: string, pattern: RegExp, parse: (text: string) => string | number])[] = [
  ["accountNumber", /(?:Account number|Kundennummer) (71\d{2} ?\d{4} ?\d{4})/u, (text) => text.replace(/ /gu, "")],
  ["servicePeriod.from", /(?:Service from|Zeitraum vom) (\d\d[./]\d\d[./]\d{4})/u, isoOf],
  ["servicePeriod.to", /(?:Service to|bis) (\d\d[./]\d\d[./]\d{4})/u, isoOf],
  ["currentChargesCents", /(?:Current charges|Verbrauchskosten) (-?\$?[\d.,]+(?: €)?)/u, centsOf],
  ["amountDueCents", /(?:Amount due|Rechnungsbetrag) (-?\$?[\d.,]+(?: €)?)/u, centsOf],
];

export function textLayerProcessor(): EvalExtractor<ScoredBill> {
  const loader = new DocumentLoaderPdfJs();
  return {
    id: "text-layer",
    async extract(item, context) {
      const source = item.documents[0];
      if (source === undefined) throw new Error(`${item.id} has no document`);
      const loaded = await loader.load({ bytes: await source.bytes(), mimeType: source.mimeType }, { signal: context.signal, logger: silentLogger });
      const values = new Map<string, string | number>();
      const evidence: FieldEvidence[] = [];
      for (const page of loaded.pages) {
        for (const line of page.lines ?? []) {
          for (const [path, pattern, parse] of PATTERNS) {
            const value = values.has(path) ? undefined : pattern.exec(line.text)?.[1];
            if (value === undefined) continue;
            values.set(path, parse(value));
            const span = line.spans.find((candidate) => candidate.text.includes(value));
            if (span !== undefined) evidence.push({ path, pageNumber: page.pageNumber, box: boxOf(span) });
          }
        }
      }
      const text = (path: string): string | null => {
        const value = values.get(path);
        return typeof value === "string" ? value : null;
      };
      const cents = (path: string): number | null => {
        const value = values.get(path);
        return typeof value === "number" ? value : null;
      };
      return {
        raw: {
          accountNumber: text("accountNumber"),
          servicePeriod: { from: text("servicePeriod.from"), to: text("servicePeriod.to") },
          currentChargesCents: cents("currentChargesCents"),
          amountDueCents: cents("amountDueCents"),
        },
        evidence,
      };
    },
  };
}

const boxOf = (span: LayoutBox): LayoutBox => ({ x: span.x, y: span.y, width: span.width, height: span.height });

// ── 5. The corpus and the run ───────────────────────────────────────────────────────

export const SEEDS = [1, 2] as const;

export async function buildCorpus(out: string): Promise<CorpusReport> {
  return writeCorpus(out, {
    model: billModel,
    templates: [compactUs, zweispaltigDe],
    seeds: SEEDS,
    scenarios: [manyLines, creditBalance],
    renditions: [digital(), scan({ severity: 0.4, dpi: 150 }), photo({ severity: 0.5, dpi: 150 })],
    createdAt: "2025-11-01T00:00:00Z",
  });
}

export async function scoreCorpus(manifest: string): Promise<EvalResult> {
  return runEval({
    dataset: jsonlDataset(manifest, { id: "utility-bills", toExpected: scoredPart }),
    spec: billSpec,
    experiments: textLayerProcessor(),
    slices: { rendition: "tags.rendition", template: "tags.template", scenario: "tags.scenario" },
    sections: [groundingSection()],
  });
}

const fixed = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : value.toFixed(3));

async function main(): Promise<void> {
  heading("A synthetic corpus, scored with no labeling");

  step("1. one sample of the credit-balance scenario");
  const sample = await billModel.sample({ seed: 1, scenario: creditBalance });
  field("account number", `${sample.value.accountNumber} (Luhn check digit ${sample.value.accountNumber.at(-1)})`);
  field("usage lines", sample.value.usage.length);
  field("previous balance (cents)", sample.value.previousBalanceCents);
  field("amount due (cents)", sample.value.amountDueCents);

  step("2. write the corpus");
  const out = await mkdtemp(join(tmpdir(), "docture-synthetic-corpus-"));
  const started = performance.now();
  const report = await buildCorpus(out);
  field("written", `${report.written} cases in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  field("failed", report.failed.length);
  field("manifest", report.manifest);
  const again = await buildCorpus(out);
  field("rerun", `${again.written} written, ${again.skipped} skipped`);

  step("3. score the text-layer processor");
  const result = await scoreCorpus(report.manifest);
  const summary = result.summary["text-layer"];
  field("cases", `${summary?.cases.scored} scored, ${summary?.cases.errored} errored`);
  field("overall F1", fixed(summary?.overall["f1"]));
  for (const dimension of ["rendition", "template", "scenario"]) {
    console.log();
    table(
      [
        { header: dimension, width: 16 },
        { header: "cases", width: 5, right: true },
        { header: "F1", width: 6, right: true },
      ],
      Object.entries(summary?.slices[dimension] ?? {}).map(([value, slice]) => [value, slice.cases, fixed(slice.metrics["f1"])]),
    );
  }

  step("4. grounding against the synthetic boxes");
  const grounding = result.grounding?.experiments["text-layer"];
  table(
    [
      { header: "field", width: 22 },
      { header: "labelled", width: 8, right: true },
      { header: "grounded", width: 8, right: true },
    ],
    PATTERNS.map(([path]) => [path, grounding?.patterns[path]?.labelled ?? 0, grounding?.patterns[path]?.grounded ?? 0]),
  );
  note(
    "Every digital case scores 1.0 and every scan and photo scores 0: the processor reads\n" +
      "the text layer, and a degraded rendition has none. The boxes it cites overlap the\n" +
      "boxes the renderer recorded, so grounding passes wherever the value was found.",
  );
}

if (isMain(import.meta.url)) await run(main);
