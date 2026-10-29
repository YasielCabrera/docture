import { describe, expect, it } from "vitest";
import { defineTemplate, gen, LabelVerificationError, locales, scenario, type FieldLabel, type SyntheticDocument } from "../src/index.js";
import { renderPdf } from "../src/pdfkit/index.js";
import { assertVerified, verifyLabels } from "../src/verify/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";
import { classic } from "./templates.js";

const overflowing = defineTemplate<Invoice>()({
  key: "overflowing",
  family: "invoice",
  locale: locales["de-DE"],
  printed: {
    invoiceNumber: true,
    issuedAt: false,
    dueAt: false,
    currency: false,
    seller: false,
    buyer: false,
    paymentMethod: false,
    lineItems: false,
    subtotalCents: false,
    taxCents: false,
    totalCents: false,
    note: false,
  },
  draw(page, value) {
    page.field("invoiceNumber", `Rechnungsnummer ${value.invoiceNumber} für alle Leistungen im Abrechnungszeitraum`, { x: 560, y: 50 });
  },
});

const relabel = (document: SyntheticDocument, path: string, change: (label: FieldLabel) => FieldLabel): SyntheticDocument => ({
  ...document,
  labels: document.labels.map((label) => (label.path === path ? change(label) : label)),
});

describe("verifyLabels", () => {
  it("confirms every label of the classic template across seeds", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const document = await renderPdf(classic, await invoiceModel.sample({ seed }));
      expect(await verifyLabels(document)).toEqual({ ok: true, checked: document.labels.length, failures: [] });
    }
  });

  it("confirms labels on every page of a 101-line table and inside a wrapped note", async () => {
    const long = scenario<Invoice>({ name: "long", fields: { lineItems: gen.array({ length: 101 }), note: gen.words(60, 60) } });
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 2, scenario: long }));
    const note = document.labels.find((label) => label.path === "note");
    expect(note?.box.height).toBeGreaterThan(30);
    const rows = document.labels.filter((label) => label.path.startsWith("lineItems["));
    expect(rows).toHaveLength(303);
    expect(rows.at(-1)?.pageNumber).toBe(document.pages.length);
    expect(await verifyLabels(document)).toEqual({ ok: true, checked: document.labels.length, failures: [] });
  });

  it("reports a label whose box sits away from its text as outside-box", async () => {
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 1 }));
    const moved = relabel(document, "invoiceNumber", (label) => ({ ...label, box: { ...label.box, y: label.box.y + 200 } }));
    const report = await verifyLabels(moved);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => [failure.path, failure.kind, failure.pageNumber])).toEqual([["invoiceNumber", "outside-box", 1]]);
  });

  it("reports a label whose text the page does not show as missing", async () => {
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 1 }));
    const altered = relabel(document, "invoiceNumber", (label) => ({ ...label, text: "INV-NOT-PRINTED" }));
    expect((await verifyLabels(altered)).failures).toEqual([
      { path: "invoiceNumber", kind: "missing", pageNumber: 1, message: '"INV-NOT-PRINTED" is not on page 1' },
    ]);
  });

  it("reports unwrapped text drawn past the right edge as page-overflow", async () => {
    const document = await renderPdf(overflowing, await invoiceModel.sample({ seed: 1 }));
    const [failure, ...rest] = (await verifyLabels(document)).failures;
    expect(rest).toEqual([]);
    expect(failure?.path).toBe("invoiceNumber");
    expect(failure?.kind).toBe("page-overflow");
    expect(failure?.message).toMatch(/^box \[560, 50, [\d.]+ × [\d.]+\] leaves the 595\.28 × 841\.89 page$/u);
  });

  it("rejects a rendition without a text layer, naming its kind", async () => {
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 1 }));
    await expect(verifyLabels({ ...document, rendition: { kind: "photo", severity: 0.5 } })).rejects.toThrow(
      new RangeError('verifyLabels reads the text layer of a digital rendition; a "photo" rendition has none'),
    );
  });
});

describe("assertVerified", () => {
  it("passes a faithful rendering and throws LabelVerificationError naming each failed path", async () => {
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 3 }));
    await assertVerified(document);
    const broken = relabel(relabel(document, "totalCents", (label) => ({ ...label, text: "0,00 $" })), "buyer.name", (label) => ({ ...label, box: { ...label.box, x: label.box.x + 300 } }));
    const error = await assertVerified(broken).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabelVerificationError);
    expect((error as LabelVerificationError).failures.map((failure) => [failure.path, failure.kind])).toEqual([
      ["buyer.name", "outside-box"],
      ["totalCents", "missing"],
    ]);
    expect((error as LabelVerificationError).message).toContain("\n  - totalCents: \"0,00 $\" is not on page 1");
  });
});
