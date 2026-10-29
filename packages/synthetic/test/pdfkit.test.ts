import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineTemplate, gen, locales, scenario, TemplateError, type Sample } from "../src/index.js";
import { renderPdf } from "../src/pdfkit/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";
import { classic } from "./templates.js";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const geist = new Uint8Array(readFileSync(new URL("../../../brand/fonts/geist-400.ttf", import.meta.url)));

describe("renderPdf", () => {
  it("labels every printed field with its page and box, and the expected value masks what is not printed", async () => {
    const sample = await invoiceModel.sample({ seed: 11 });
    const doc = await renderPdf(classic, sample);
    const value = sample.value;
    expect(doc.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(doc.bytes.slice(0, 5))).toBe("%PDF-");
    const expected = doc.expected as Record<string, unknown>;
    expect(expected.currency).toBeNull();
    expect(expected.paymentMethod).toBe(value.paymentMethod === "card" ? "card" : "bank");
    expect(expected.totalCents).toBe(value.totalCents);
    expect((expected.lineItems as Record<string, unknown>[])[0]).toEqual({ ...value.lineItems[0], unitPriceCents: null });

    const total = doc.labels.find((label) => label.path === "totalCents");
    expect(total?.value).toBe(value.totalCents);
    expect(total?.text).toMatch(/^-?[\d.]+,\d\d €$/u);
    expect(total?.box.x).toBeCloseTo(545.28 - (total?.box.width ?? 0), 5);
    const paths = new Set(doc.labels.map((label) => label.path));
    expect(paths.has("currency")).toBe(false);
    expect(paths.has("lineItems[0].unitPriceCents")).toBe(false);
    expect(paths.has(`lineItems[${value.lineItems.length - 1}].amountCents`)).toBe(true);
    expect(doc.pages).toEqual([{ pageNumber: 1, width: 595.28, height: 841.89 }]);
  });

  it("paginates a long table, repeating the header and labeling rows on later pages", async () => {
    const many = scenario<Invoice>({ name: "many-lines", fields: { lineItems: gen.array({ length: 101 }) } });
    const doc = await renderPdf(classic, await invoiceModel.sample({ seed: 2, scenario: many }));
    expect(doc.pages.length).toBeGreaterThanOrEqual(3);
    const last = doc.labels.find((label) => label.path === "lineItems[100].amountCents");
    expect(last?.pageNumber).toBe(doc.pages.length);
    const rows = doc.labels.filter((label) => label.path.endsWith(".amountCents"));
    expect(rows).toHaveLength(101);
    for (const row of rows) expect(row.box.y + row.box.height).toBeLessThanOrEqual(841.89 - 60);
  });

  it("produces byte-identical output for the same seed, with standard and embedded fonts", async () => {
    const embedded = { ...classic, key: "classic-geist", fonts: { ...classic.fonts, regular: geist } };
    for (const template of [classic, embedded]) {
      const first = await renderPdf(template, await invoiceModel.sample({ seed: 5 }));
      const second = await renderPdf(template, await invoiceModel.sample({ seed: 5 }));
      expect(sha(second.bytes)).toBe(sha(first.bytes));
      expect(second.labels).toEqual(first.labels);
      const other = await renderPdf(template, await invoiceModel.sample({ seed: 6 }));
      expect(sha(other.bytes)).not.toBe(sha(first.bytes));
    }
  });

  it("rejects a template that draws an undeclared field or skips a declared one", async () => {
    const sample = await invoiceModel.sample({ seed: 1 });
    const sloppy = defineTemplate<Invoice>()({
      ...classic,
      key: "sloppy",
      draw(page, value) {
        page.field("currency", value.currency, { x: 50, y: 50 });
      },
    });
    const error = await renderPdf(sloppy, sample).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateError);
    const problems = (error as TemplateError).problems;
    expect(problems).toContainEqual({ code: "undeclared-field", path: "currency", message: "is drawn, but the printed mask does not declare it or its value is absent" });
    expect(problems).toContainEqual({ code: "unprinted-field", path: "totalCents", message: "is declared printed, but the template never draws it" });
  });

  it("names the field whose text the standard font cannot draw", async () => {
    const minus = { ...locales["de-DE"], minus: "−" };
    const credit = scenario<Invoice>({ name: "credit", fields: { "lineItems[].unitPriceCents": gen.int(-5000, -100) } });
    const sample: Sample<Invoice> = await invoiceModel.sample({ seed: 4, scenario: credit });
    const error = await renderPdf({ ...classic, locale: minus }, sample).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateError);
    expect((error as TemplateError).problems).toContainEqual({ code: "missing-glyph", path: "totalCents", message: 'font "bold" cannot draw "−" (U+2212)' });
  });
});
