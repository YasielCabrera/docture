import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLogger, type LayoutBox } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { defineModel, gen, locales, prints, project, scenario, TemplateError, typedJsonSchema, type Formatter } from "../src/index.js";
import { defineHtmlTemplate, escapeHtml as e, renderHtmlPdf } from "../src/html/index.js";
import { verifyLabels } from "../src/verify/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const geist = readFileSync(new URL("../../../brand/fonts/geist-400.ttf", import.meta.url)).toString("base64");
const ROWS_PER_PAGE = 20;

const rows = (value: Invoice, f: Formatter, from: number): string =>
  value.lineItems
    .slice(from, from + ROWS_PER_PAGE)
    .map((item, offset) => {
      const index = from + offset;
      return `<tr><td>${index + 1}</td><td data-field="lineItems[${index}].description">${e(item.description)}</td><td class="num" data-field="lineItems[${index}].quantity">${f.number(item.quantity)}</td><td class="num" data-field="lineItems[${index}].amountCents">${f.money(item.amountCents)}</td></tr>`;
    })
    .join("");

const table = (body: string): string => `<table><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="num">Menge</th><th class="num">Betrag</th></tr></thead><tbody>${body}</tbody></table>`;

const modern = defineHtmlTemplate<Invoice>()({
  key: "modern-html",
  family: "invoice",
  tags: { engine: "html" },
  locale: locales["de-DE"],
  css: `@font-face { font-family: Geist; src: url(data:font/ttf;base64,${geist}) }
    body { font: 9pt/1.3 Geist }
    section.page { padding: 50pt }
    h1 { font-size: 20pt; margin: 0 0 12pt }
    table { width: 100%; border-collapse: collapse; margin-top: 24pt }
    th, td { text-align: left; padding: 3pt; border-bottom: 0.5pt solid #999 }
    .num { text-align: right }
    .totals { margin: 12pt 0 0 auto; width: 220pt }`,
  printed: {
    invoiceNumber: true,
    issuedAt: true,
    dueAt: true,
    currency: false,
    seller: { name: true, iban: true, vatId: true },
    buyer: { name: true, contact: true },
    paymentMethod: prints((method: Invoice["paymentMethod"]) => (method === "card" ? "card" : "bank")),
    lineItems: { items: { description: true, quantity: true, unitPriceCents: false, amountCents: true } },
    subtotalCents: true,
    taxCents: true,
    totalCents: true,
    note: (note) => note.length > 0,
  },
  render(value, f) {
    const starts = Array.from({ length: Math.ceil(value.lineItems.length / ROWS_PER_PAGE) }, (_, page) => page * ROWS_PER_PAGE);
    const header = `<h1>RECHNUNG</h1>
      <p><span data-field="seller.name">${e(value.seller.name)}</span>${value.seller.vatId === undefined ? "" : `<br><span data-field="seller.vatId">USt-IdNr. ${e(value.seller.vatId)}</span>`}</p>
      <p>Rechnungsnr. <span data-field="invoiceNumber">${e(value.invoiceNumber)}</span><br>Datum <span data-field="issuedAt">${f.date(value.issuedAt)}</span><br>Fällig <span data-field="dueAt">${f.date(value.dueAt)}</span></p>
      <p>An <span data-field="buyer.name">${e(value.buyer.name)}</span>${value.buyer.contact === undefined ? "" : `<br><span data-field="buyer.contact">z. Hd. ${e(value.buyer.contact)}</span>`}</p>`;
    const closing = `<table class="totals">
        <tr><td>Zwischensumme</td><td class="num" data-field="subtotalCents">${f.money(value.subtotalCents)}</td></tr>
        <tr><td>USt. 19 %</td><td class="num" data-field="taxCents">${f.money(value.taxCents)}</td></tr>
        <tr><th>Gesamt</th><th class="num" data-field="totalCents">${f.money(value.totalCents)}</th></tr>
      </table>
      <p>Zahlung <span data-field="paymentMethod">${value.paymentMethod === "card" ? "Kartenzahlung" : "Überweisung"}</span><br><span data-field="seller.iban">IBAN ${e(value.seller.iban)}</span></p>
      ${value.note === null ? "" : `<p data-field="note">${e(value.note)}</p>`}`;
    return starts
      .map((from, page) => `<section class="page">${page === 0 ? header : ""}${table(rows(value, f, from))}${page === starts.length - 1 ? closing : ""}</section>`)
      .join("");
  },
});

/** Every in-use cross-reference entry must point at the start of its own object. */
function brokenXref(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("latin1");
  const start = Number(/startxref\s+(\d+)\s+%%EOF\s*$/u.exec(text)?.[1]);
  const [, first, count] = /^xref\s+(\d+) (\d+)/u.exec(text.slice(start)) ?? [];
  const entries = [...text.slice(start, text.lastIndexOf("trailer")).matchAll(/(\d{10}) (\d{5}) ([nf])/gu)];
  expect(entries).toHaveLength(Number(count));
  return entries.flatMap(([, offset, , kind], index) => {
    const object = Number(first) + index;
    return kind === "n" && !text.startsWith(`${object} 0 obj`, Number(offset)) ? [`object ${object} at ${offset}`] : [];
  });
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe("renderHtmlPdf", () => {
  it("labels each printed leaf once with the text and box of its marked element", async () => {
    const sample = await invoiceModel.sample({ seed: 11 });
    const doc = await renderHtmlPdf(modern, sample, { browser });
    const value = sample.value;
    expect(new TextDecoder().decode(doc.bytes.slice(0, 5))).toBe("%PDF-");
    expect(doc.pages).toEqual([{ pageNumber: 1, width: 595.28, height: 841.89 }]);
    expect(doc.labels.map((label) => label.path).sort()).toEqual([...project(modern.printed, value).leaves.keys()].sort());
    expect(doc.labels).toHaveLength(new Set(doc.labels.map((label) => label.path)).size);
    expect(doc.expected).toMatchObject({ currency: null, paymentMethod: value.paymentMethod === "card" ? "card" : "bank" });
    const total = doc.labels.find((label) => label.path === "totalCents");
    expect(total).toMatchObject({ value: value.totalCents, text: "1.710,89 €", pageNumber: 1 });
    expect(doc.labels.find((label) => label.path === "seller.vatId")?.text).toBe(`USt-IdNr. ${value.seller.vatId}`);
    expect(doc.template).toEqual({ key: "modern-html", family: "invoice", tags: { engine: "html", locale: "de-DE" } });
    expect(await verifyLabels(doc)).toEqual({ ok: true, checked: doc.labels.length, failures: [] });
  });

  it("puts every box inside its page and later rows on later pages", async () => {
    const many = scenario<Invoice>({ name: "many-lines", fields: { lineItems: gen.array({ length: 45 }) } });
    const doc = await renderHtmlPdf(modern, await invoiceModel.sample({ seed: 2, scenario: many }), { browser });
    expect(doc.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(doc.labels.find((label) => label.path === "lineItems[19].amountCents")?.pageNumber).toBe(1);
    expect(doc.labels.find((label) => label.path === "lineItems[20].amountCents")?.pageNumber).toBe(2);
    expect(doc.labels.find((label) => label.path === "totalCents")?.pageNumber).toBe(3);
    const outside = doc.labels.filter(({ box }) => !(box.x >= 49.9 && box.y >= 49.9 && box.width > 0 && box.height > 0 && box.x + box.width <= 545.38 && box.y + box.height <= 791.99));
    expect(outside).toEqual([]);
    expect(await verifyLabels(doc)).toEqual({ ok: true, checked: doc.labels.length, failures: [] });
  });

  it("prints byte-identical PDFs with a pinned Info dictionary and a valid cross-reference table", async () => {
    const sample = await invoiceModel.sample({ seed: 5 });
    const first = await renderHtmlPdf(modern, sample);
    const second = await renderHtmlPdf(modern, sample, { browser });
    expect(sha(second.bytes)).toBe(sha(first.bytes));
    expect(second.labels).toEqual(first.labels);
    const text = Buffer.from(first.bytes).toString("latin1");
    expect(/1 0 obj\s*(<<[^]*?>>)/u.exec(text)?.[1]).toBe("<</Creator (Chromium)\n/Producer (@docture/synthetic)\n/CreationDate (D:20000101000000+00'00')\n/ModDate (D:20000101000000+00'00')>>");
    expect(brokenXref(first.bytes)).toEqual([]);
    const dated = await renderHtmlPdf(modern, sample, { browser, createdAt: "2024-06-30T12:34:56Z" });
    expect(Buffer.from(dated.bytes).toString("latin1")).toContain("/CreationDate (D:20240630123456+00'00')");
    expect(brokenXref(dated.bytes)).toEqual([]);
  });

  it("rejects a template that declares a field it never marks", async () => {
    const sloppy = defineHtmlTemplate<Invoice>()({ ...modern, key: "sloppy-html", render: (value, f) => modern.render(value, f).replace(' data-field="invoiceNumber"', "") });
    const error = await renderHtmlPdf(sloppy, await invoiceModel.sample({ seed: 1 }), { browser }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateError);
    expect((error as TemplateError).problems).toEqual([{ code: "unprinted-field", path: "invoiceNumber", message: "is declared printed, but the template never draws it" }]);
  });

  it("rejects a field that runs off the bottom of its page section", async () => {
    const tall = defineHtmlTemplate<Invoice>()({ ...modern, key: "tall-html", css: `${modern.css} tbody tr { height: 60pt }` });
    const many = scenario<Invoice>({ name: "many-lines", fields: { lineItems: gen.array({ length: 20 }) } });
    const error = await renderHtmlPdf(tall, await invoiceModel.sample({ seed: 2, scenario: many }), { browser }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateError);
    const problems = (error as TemplateError).problems;
    expect(problems.every((problem) => problem.code === "invalid-template")).toBe(true);
    expect(problems.map((problem) => problem.path)).toContain("totalCents");
    expect(problems.find((problem) => problem.path === "lineItems[19].amountCents")?.message).toMatch(/^lies outside page 1 at x \d+\.\d, y \d+\.\d, \d+\.\d × \d+\.\d$/u);
  });

  it("boxes the text of a block or table cell, not the whole element", async () => {
    type Party = { name: string; total: number };
    const schema = typedJsonSchema<Party>({ type: "object", required: ["name", "total"], properties: { name: { type: "string" }, total: { type: "number" } } });
    const sample = await defineModel(schema, { fields: { name: gen.value("Kestrel Labs"), total: gen.value(12.5) } }).sample({ seed: 1 });
    const wide = defineHtmlTemplate<Party>()({
      key: "wide-html",
      family: "party",
      locale: locales["en-US"],
      css: "section.page { padding: 50pt; font: 10pt Helvetica } table { width: 100% }",
      printed: { name: true, total: true },
      render: (value, f) => `<section class="page"><div data-field="name">${e(value.name)}</div><table><tr><td>Total</td><td style="text-align: right" data-field="total">${f.number(value.total, 2)}</td></tr></table></section>`,
    });
    const document = await renderHtmlPdf(wide, sample, { browser });
    const loaded = await new DocumentLoaderPdfJs().load({ bytes: document.bytes, mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
    const spans = (loaded.pages[0]?.lines ?? []).flatMap((line) => line.spans);
    const iou = (a: LayoutBox, b: LayoutBox): number => {
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return overlap / (a.width * a.height + b.width * b.height - overlap);
    };
    for (const label of document.labels) {
      const span = spans.find((candidate) => candidate.text.trim() === label.text);
      expect(span, label.path).not.toBeUndefined();
      expect(iou(label.box, span!), label.path).toBeGreaterThan(0.5);
    }
  });
});
