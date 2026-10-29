import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineModel, defineTemplate, drawTable, formatPattern, gen, locales, project, scenario, SynthesisError, typedJsonSchema, type PrintedMask } from "../src/index.js";
import { digital, scan, writeCorpus } from "../src/node/index.js";
import type { Faker } from "@faker-js/faker";
import { fakerFor } from "../src/faker/index.js";
import { renderPdf } from "../src/pdfkit/index.js";
import { verifyLabels } from "../src/verify/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";
import { classic } from "./templates.js";

const dirs: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "synthetic-edge-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Named = { name: string };
const named = typedJsonSchema<Named>({ type: "object", required: ["name"], properties: { name: { type: "string" } } });
const nameSlip = defineTemplate<Named>()({
  key: "slip",
  family: "slip",
  locale: locales["en-US"],
  page: { size: { width: 200, height: 100 } },
  printed: { name: true },
  draw(page, value) {
    page.field("name", value.name, { x: 10, y: 10 });
  },
});

describe("sampling edge cases", () => {
  it("samples Zod string formats that carry a pattern", async () => {
    const Schema = z.object({ day: z.iso.date(), mail: z.email(), id: z.uuid(), at: z.iso.datetime() });
    const { value } = await defineModel(Schema).sample({ seed: 3 });
    expect(Schema.safeParse(value).success).toBe(true);
    expect(value.day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("keeps numbers inside exclusive bounds and arrays inside maxItems", async () => {
    const Schema = z.object({ rate: z.number().gt(0).lt(1), tags: z.array(z.string()).max(1) });
    const model = defineModel(Schema, { arrays: [2, 4] });
    for (let seed = 0; seed < 300; seed++) {
      const { value } = await model.sample({ seed });
      expect(value.rate).toBeGreaterThan(0);
      expect(value.rate).toBeLessThan(1);
      expect(value.tags).toHaveLength(1);
    }
  });

  it("samples next to a one-sided bound and ignores Zod's safe-integer limits", async () => {
    const plain = defineModel(typedJsonSchema<{ below: number; above: number; step: number }>({
      type: "object",
      required: ["below", "above", "step"],
      properties: { below: { type: "integer", maximum: -5 }, above: { type: "integer", minimum: 2000 }, step: { type: "integer", multipleOf: 5, minimum: 1, maximum: 4 } },
    }));
    await expect(plain.sample({ seed: 1 })).rejects.toThrow(new SynthesisError([{ path: "step", message: "no multiple of 5 lies within the bounds; give it a generator" }]));
    const Bounded = z.object({ count: z.int().min(1), big: z.number().min(2000), negative: z.number().max(-1), below: z.int().max(-5) });
    const values = await Promise.all(Array.from({ length: 50 }, async (_, seed) => (await defineModel(Bounded).sample({ seed })).value));
    for (const value of values) {
      expect(Bounded.safeParse(value).success).toBe(true);
      expect(value.count).toBeLessThanOrEqual(1001);
      expect(value.big).toBeLessThanOrEqual(3000);
      expect(value.negative).toBeGreaterThanOrEqual(-1001);
      expect(value.below).toBeGreaterThanOrEqual(-1005);
    }
    expect(new Set(values.map((value) => value.count)).size).toBeGreaterThan(40);
  });

  it("samples unions of referenced schemas and tuples at their own length", async () => {
    const Kind = z.enum(["a1", "a2"]).meta({ id: "Kind" });
    const Code = z.literal("b1").meta({ id: "Code" });
    const Schema = z.object({ k: z.union([Kind, Code]), t: z.tuple([z.string(), z.number()]) });
    for (let seed = 0; seed < 20; seed++) {
      const { value } = await defineModel(Schema).sample({ seed });
      expect(Schema.safeParse(value).success).toBe(true);
      expect(value.t).toHaveLength(2);
    }
  });

  it("bounds a recursive schema, leaving deep optional branches out", async () => {
    const Section = z.object({
      title: z.string(),
      get subsections() {
        return z.array(Section).optional();
      },
    });
    const Outline = z.object({ sections: z.array(Section) });
    const depth = (sections: readonly { subsections?: readonly unknown[] | undefined }[] | undefined): number =>
      sections === undefined || sections.length === 0 ? 0 : 1 + Math.max(...sections.map((section) => depth(section.subsections as never)));
    for (let seed = 0; seed < 10; seed++) {
      const { value } = await defineModel(Outline).sample({ seed });
      expect(Outline.safeParse(value).success).toBe(true);
      expect(depth(value.sections)).toBeLessThanOrEqual(4);
    }
    const Endless = z.object({ get next() { return z.array(Endless).min(1); } });
    await expect(defineModel(z.object({ head: Endless })).sample({ seed: 1 })).rejects.toThrow(/the recursive schema keeps requiring deeper values; give it a generator/u);
  });

  it("lets a scenario pattern override a model's concrete path at the same position", async () => {
    const Prices = z.object({ lineItems: z.array(z.object({ unitPriceCents: z.number() })) });
    const zero = scenario<z.infer<typeof Prices>>({ name: "zero", fields: { "lineItems[].unitPriceCents": gen.value(0) } });
    const model = defineModel(Prices, {
      fields: { lineItems: gen.array({ length: 3 }), "lineItems[0].unitPriceCents": gen.value(99) },
    });
    const { value } = await model.sample({ seed: 1, scenario: zero });
    expect(value.lineItems.map((item) => item.unitPriceCents)).toEqual([0, 0, 0]);
  });
});

describe("paths and masks", () => {
  it("keeps index-like text inside a quoted key when forming a pattern", () => {
    expect(formatPattern(["rows", 2, "a[1]"])).toBe("rows[].`a[1]`");
  });

  it("projects an empty array to null when its items never print, and to [] when they do", () => {
    type Doc = { xs: number[]; ys: number[] };
    const mask: PrintedMask<Doc> = { xs: { items: false }, ys: { items: true } };
    expect(project(mask, { xs: [], ys: [] }).expected).toEqual({ xs: null, ys: [] });
  });
});

describe("rendering and verification edge cases", () => {
  it("verifies a wrapped table cell next to another column", async () => {
    const wordy = scenario<Invoice>({ name: "wordy", fields: { lineItems: gen.array({ length: 2 }), "lineItems[].description": gen.words(14, 14) } });
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 8, scenario: wordy }));
    const cell = document.labels.find((label) => label.path === "lineItems[0].description");
    expect(cell?.box.height).toBeGreaterThan(20);
    expect(await verifyLabels(document)).toEqual({ ok: true, checked: document.labels.length, failures: [] });
  });

  it("draws and boxes each line of a multi-line field", async () => {
    const model = defineModel(named, { fields: { name: gen.value("12 Main Street\nSpringfield 4410") } });
    const document = await renderPdf({ ...nameSlip, page: { size: { width: 300, height: 100 }, margin: 10 } }, await model.sample({ seed: 1 }));
    expect(document.labels[0]?.box.height).toBeCloseTo(20.81, 2);
    expect((await verifyLabels(document)).ok).toBe(true);
  });

  it("labels table cells of keys that need quoting", async () => {
    type Rows = { rows: { "unit.price": number }[] };
    const schema = typedJsonSchema<Rows>({
      type: "object",
      required: ["rows"],
      properties: { rows: { type: "array", minItems: 1, maxItems: 1, items: { type: "object", required: ["unit.price"], properties: { "unit.price": { type: "integer" } } } } },
    });
    const table = defineTemplate<Rows>()({
      key: "rows",
      family: "rows",
      locale: locales["en-US"],
      printed: { rows: { items: { "unit.price": true } } },
      draw(page, value) {
        drawTable(page, { path: "rows", items: value.rows, x: 50, y: 50, bottom: 780, continueAt: 50, columns: [{ header: "Price", width: 100, key: "unit.price", text: (row) => String(row["unit.price"]) }] });
      },
    });
    const document = await renderPdf(table, await defineModel(schema).sample({ seed: 1 }));
    expect(document.labels.map((label) => label.path)).toEqual(["rows[0].`unit.price`"]);
  });
});

describe("corpus identity and resume", () => {
  it("gives renditions that differ only in dpi their own cases, and rejects a plan with duplicate ids", async () => {
    const dir = await tempDir();
    const model = defineModel(named, { fields: { name: gen.value("Ada") } });
    const report = await writeCorpus(dir, { model, templates: [nameSlip], seeds: [1], renditions: [scan({ severity: 0.3, dpi: 72 }), scan({ severity: 0.3, dpi: 144 })] });
    const ids = (await readFile(report.manifest, "utf8")).trim().split("\n").map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids).toEqual(["slip-base-1-scan-0.3-72dpi", "slip-base-1-scan-0.3-144dpi"]);
    await expect(writeCorpus(dir, { model, templates: [nameSlip], seeds: [1, "1"] })).rejects.toThrow(
      new RangeError("The corpus plan produces duplicate case ids: slip-base-1-digital. Remove repeated seeds, scenarios, templates or renditions."),
    );
  });

  it("rewrites a case when a faker generator's builder or locale changes", async () => {
    const dir = await tempDir();
    const plan = { templates: [nameSlip], seeds: [1], renditions: [digital()] };
    const write = async (locale: string, build: (faker: Faker) => string) =>
      writeCorpus(dir, { ...plan, model: defineModel(named, { fields: { name: (await fakerFor(locale))(build) } }) });
    await write("en", (faker) => faker.company.name());
    expect(await write("en", (faker) => faker.person.lastName())).toMatchObject({ written: 1, skipped: 0 });
    expect(await write("de", (faker) => faker.person.lastName())).toMatchObject({ written: 1, skipped: 0 });
    expect(await write("de", (faker) => faker.person.lastName())).toMatchObject({ written: 0, skipped: 1 });
  });

  it("rewrites a case when the model's generators or the verify setting change", async () => {
    const dir = await tempDir();
    const plan = { templates: [nameSlip], seeds: [1], renditions: [digital()] };
    await writeCorpus(dir, { ...plan, model: defineModel(named, { fields: { name: gen.value("OLD") } }) });
    const changed = await writeCorpus(dir, { ...plan, model: defineModel(named, { fields: { name: gen.value("NEW") } }) });
    expect(changed).toMatchObject({ written: 1, skipped: 0 });
    expect(JSON.parse(await readFile(join(dir, "cases", "slip-base-1-digital", "expected.json"), "utf8"))).toEqual({ name: "NEW" });
    const unverified = await writeCorpus(dir, { ...plan, verify: false, model: defineModel(named, { fields: { name: gen.value("NEW") } }) });
    expect(unverified).toMatchObject({ written: 1, skipped: 0 });
  });
});
