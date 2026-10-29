import { describe, expect, it } from "vitest";
import { defineModel, defineTemplate, gen, locales, pageSizes, typedJsonSchema } from "../src/index.js";
import { compareLayouts, measurePdf, type LayoutComparison } from "../src/measure/index.js";
import { renderPdf } from "../src/pdfkit/index.js";
import { invoiceModel } from "./fixtures.js";
import { classic } from "./templates.js";

type Form = { name: string; date: string };
const formSchema = typedJsonSchema<Form>({ type: "object", required: ["name", "date"], properties: { name: { type: "string" }, date: { type: "string" } } });
const formModel = defineModel(formSchema, { fields: { name: gen.value("Ada Lovelace"), date: gen.value("10.07.1843") } });

const form = (options: { readonly shift?: { readonly x: number; readonly y: number }; readonly footer?: string; readonly answers?: number } = {}) =>
  defineTemplate<Form>()({
    key: "form",
    family: "form",
    locale: locales["de-DE"],
    page: { size: pageSizes.A5 },
    printed: { name: true, date: true },
    draw(page, value) {
      const shift = options.shift ?? { x: 0, y: 0 };
      page.text("Antrag auf Erstattung", { x: 40, y: 40, size: 16, font: "bold" });
      page.text("Name", { x: 40, y: 90 });
      page.field("name", value.name, { x: 140, y: 90 });
      page.text("Datum", { x: 40 + shift.x, y: 110 + shift.y });
      page.field("date", value.date, { x: 140, y: 110 });
      for (let index = 0; index < (options.answers ?? 2); index++) page.text("ja", { x: 40 + index * 100, y: 150 });
      if (options.footer !== undefined) page.text(options.footer, { x: 40, y: 500, size: 8 });
    },
  });

const rendered = async (template: ReturnType<typeof form>) => renderPdf(template, await formModel.sample({ seed: 1 }));
const drifts = (comparison: LayoutComparison) => comparison.matched.map((line) => [line.text, Math.round(line.dx * 100) / 100, Math.round(line.dy * 100) / 100]);

describe("measurePdf", () => {
  it("boxes a drawn text where PDFKit placed it, from its baseline up one font size", async () => {
    const document = await rendered(form());
    const label = document.labels.find((one) => one.path === "name");
    const measured = (await measurePdf(document.bytes)).pages[0]?.lines.find((line) => line.text === "Ada Lovelace");
    expect(label?.box).toEqual({ x: 140, y: 90, width: 60.19, height: 9.25 });
    // Helvetica's ascender is 0.718 em: PDFKit puts the baseline 7.18 points under the box top at 10 points.
    expect(measured?.box.x).toBeCloseTo(140, 1);
    expect(measured?.box.width).toBeCloseTo(60.19, 1);
    expect(measured?.box.y).toBeCloseTo(90 + 7.18 - 10, 1);
    expect(measured?.box.height).toBeCloseTo(10, 1);
  });

  it("splits a visual line into separate lines at gaps wider than the font size", async () => {
    const measurement = await measurePdf((await rendered(form())).bytes);
    expect(measurement.pages.map((page) => [page.pageNumber, page.width, page.height])).toEqual([[1, 419.53, 595.28]]);
    expect(measurement.pages[0]?.lines.map((line) => line.text)).toEqual(["Antrag auf Erstattung", "Name", "Ada Lovelace", "Datum", "10.07.1843", "ja", "ja"]);
  });
});

describe("compareLayouts", () => {
  it("finds zero drift between two renders of one template and sample", async () => {
    const sample = await invoiceModel.sample({ seed: 1 });
    const reference = await renderPdf(classic, sample);
    const comparison = await compareLayouts(await measurePdf(reference.bytes), await renderPdf(classic, sample));
    expect([comparison.ok, comparison.tolerance, comparison.maxDrift, comparison.matched.length]).toEqual([true, 0.5, 0, 36]);
    expect(comparison.matched.filter((line) => line.dx !== 0 || line.dy !== 0)).toEqual([]);
    expect([comparison.onlyInReference, comparison.onlyInCandidate]).toEqual([[], []]);
    expect(comparison.repeated).toEqual([{ pageNumber: 1, text: "1", reference: 2, candidate: 2 }]);
  });

  it("reports a line moved 7 points right and 3 down, and fails a tolerance it exceeds", async () => {
    const reference = (await rendered(form())).bytes;
    const moved = await rendered(form({ shift: { x: 7, y: 3 } }));
    const strict = await compareLayouts(reference, moved, { tolerance: 1 });
    expect(drifts(strict)).toEqual([
      ["Antrag auf Erstattung", 0, 0],
      ["Name", 0, 0],
      ["Ada Lovelace", 0, 0],
      ["Datum", 7, 3],
      ["10.07.1843", 0, 0],
    ]);
    const datum = strict.matched.find((line) => line.text === "Datum");
    expect(datum?.dx).toBeCloseTo(7, 2);
    expect(datum?.dy).toBeCloseTo(3, 2);
    expect(strict.maxDrift).toBeCloseTo(7, 2);
    expect(strict.ok).toBe(false);
    expect((await compareLayouts(reference, moved, { tolerance: 10 })).ok).toBe(true);
  });

  it("leaves repeated text unpaired and lists text that only one document shows", async () => {
    const reference = await rendered(form({ footer: "Seite 1 von 1" }));
    const candidate = await rendered(form({ footer: "Page 1 of 1", answers: 1 }));
    const comparison = await compareLayouts(reference, candidate);
    expect(comparison.matched.map((line) => line.text)).toEqual(["Antrag auf Erstattung", "Name", "Ada Lovelace", "Datum", "10.07.1843"]);
    expect(comparison.repeated).toEqual([{ pageNumber: 1, text: "ja", reference: 2, candidate: 1 }]);
    expect(comparison.onlyInReference.map((line) => [line.pageNumber, line.text])).toEqual([[1, "Seite 1 von 1"]]);
    expect(comparison.onlyInCandidate.map((line) => [line.pageNumber, line.text])).toEqual([[1, "Page 1 of 1"]]);
    expect(comparison.onlyInCandidate[0]?.box.x).toBeCloseTo(40, 1);
  });

  it("rejects a rendition without a text layer, naming its media type", async () => {
    const document = await rendered(form());
    await expect(compareLayouts(document.bytes, { ...document, mimeType: "image/png" })).rejects.toThrow(
      new RangeError('compareLayouts reads the text layer of a PDF; a "image/png" document has none'),
    );
  });
});
