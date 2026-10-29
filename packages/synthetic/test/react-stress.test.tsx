import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { looseEval } from "@docture/eval";
import { groundingSection } from "@docture/eval/grounding";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { silentLogger, type LayoutBox } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Page, Text, View } from "@react-pdf/renderer";
import { locales, locationsOf, type FieldLabel, type SyntheticDocument } from "../src/index.js";
import { degrade } from "../src/degrade/index.js";
import { digital, photo, scan, writeCorpus } from "../src/node/index.js";
import { defineReactTemplate, renderReactPdf, type FieldComponent } from "../src/react-pdf/index.js";
import { verifyLabels } from "../src/verify/index.js";
import { statementModel, stress, type Statement } from "./react-stress.js";

interface Span extends LayoutBox {
  readonly text: string;
}

async function spansByPage(bytes: Uint8Array): Promise<Map<number, Span[]>> {
  const loaded = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
  return new Map(loaded.pages.map((page) => [page.pageNumber, (page.lines ?? []).flatMap((line) => line.spans)]));
}

const overlaps = (a: LayoutBox, b: LayoutBox): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const right = (box: LayoutBox): number => box.x + box.width;
const bottom = (box: LayoutBox): number => box.y + box.height;

/**
 * Compare each label with the PDF.js spans of exactly its text: the label's left and right edges must
 * match the spans' within 1pt, and the spans must sit inside the label vertically. A label passes
 * verification with a box far too wide; this check does not.
 */
function boxDeltas(labels: readonly FieldLabel[], pages: ReadonlyMap<number, readonly Span[]>) {
  const checked: { path: string; dx: number; dRight: number; above: number; below: number }[] = [];
  const unmatched: string[] = [];
  for (const label of labels) {
    const middle = (span: Span): number => span.y + span.height / 2;
    const spans = (pages.get(label.pageNumber) ?? []).filter((span) => overlaps(span, label.box) && middle(span) > label.box.y && middle(span) < bottom(label.box));
    const normalize = (text: string): string => text.replace(/\s+/gu, " ").trim();
    // Letter spacing makes PDF.js read "1 G - 4"; compare without whitespace.
    if (normalize(spans.map((span) => span.text).join(" ")).replace(/ /gu, "") !== normalize(label.text).replace(/ /gu, "")) {
      unmatched.push(label.path);
      continue;
    }
    const x0 = Math.min(...spans.map((span) => span.x));
    const x1 = Math.max(...spans.map(right));
    const y0 = Math.min(...spans.map((span) => span.y));
    const y1 = Math.max(...spans.map(bottom));
    // PDF.js puts a span's top a full font size above the baseline, above the ink of most fonts; allow a tenth of the size.
    const size = Math.max(...spans.map((span) => span.height));
    checked.push({ path: label.path, dx: Math.abs(x0 - label.box.x), dRight: Math.abs(x1 - right(label.box)), above: label.box.y - y0 - size / 10, below: y1 - bottom(label.box) });
  }
  return { checked, unmatched };
}

let document: SyntheticDocument;

beforeAll(async () => {
  document = await renderReactPdf(stress, await statementModel.sample({ seed: 11 }));
}, 60_000);

describe("a React template that uses every layout technique", () => {
  it("labels every field across portrait, landscape and A5 pages, and verification reads each back", async () => {
    const sizes = document.pages.map((page) => [Math.round(page.width), Math.round(page.height)]);
    expect(sizes.at(-2)).toEqual([842, 595]);
    expect(sizes.at(-1)).toEqual([420, 595]);
    expect(sizes.slice(0, -2).every(([width, height]) => width === 595 && height === 842)).toBe(true);
    expect(document.pages.length).toBeGreaterThanOrEqual(5);
    expect(await verifyLabels(document)).toEqual({ ok: true, checked: document.labels.length, failures: [] });
  });

  it("fits each label box to its printed text within a point", async () => {
    const { checked, unmatched } = boxDeltas(document.labels, await spansByPage(document.bytes));
    expect(unmatched).toEqual([]);
    const worst = (key: "dx" | "dRight" | "above" | "below") => checked.reduce((max, item) => (item[key] > max[key] ? item : max));
    expect(worst("dx").dx).toBeLessThan(1);
    expect(worst("dRight").dRight).toBeLessThan(1);
    // PDF.js boxes cover the glyphs; the label covers the line, so the glyphs sit inside it.
    expect(worst("above").above).toBeLessThan(1);
    expect(worst("below").below).toBeLessThan(1);
  });

  it("follows measured coordinates, padding, borders, letter spacing, case transforms and links", () => {
    const label = (path: string, page = 1) => document.labels.find((item) => item.path === path && item.pageNumber === page);
    expect(label("customer.number")?.box.x).toBeCloseTo(70.92, 2);
    expect(right(label("reference")?.box as LayoutBox)).toBeCloseTo(545.28, 1);
    expect(label("title")?.text).toBe(label("title")?.text.toUpperCase());
    // Page padding 50, outer border 2 and padding 8, inner border 3 and padding 4, field padding 3: react-pdf
    // starts text inside a text's padding but not its border.
    expect(label("customer.name")?.box.x).toBeCloseTo(70, 1);
    expect(label("iban")?.text).toBe(document.labels.find((item) => item.path === "iban")?.value);
    expect(label("summary")).toBeDefined();
  });

  it("repeats a fixed field on every portrait page, splits a long paragraph into one label per page, and keeps rows whole", () => {
    const portrait = document.pages.length - 2;
    expect(document.labels.filter((item) => item.path === "contact").map((item) => item.pageNumber)).toEqual(Array.from({ length: portrait }, (_, index) => index + 1));
    const terms = document.labels.filter((item) => item.path === "terms");
    expect(terms.length).toBe(2);
    expect(terms[1]?.pageNumber).toBe((terms[0]?.pageNumber ?? 0) + 1);
    const words = (text: string) => text.split(/\s+/u).filter(Boolean);
    expect([...words(terms[0]?.text ?? ""), ...words(terms[1]?.text ?? "")].join(" ")).toBe(words(String(terms[0]?.value)).join(" "));
    const rows = document.labels.filter((item) => /^rows\[\d+\]\.plate$/u.test(item.path));
    expect(new Set(rows.map((item) => item.path)).size).toBe(rows.length);
    expect(new Set(rows.map((item) => item.pageNumber)).size).toBeGreaterThan(1);
    expect(document.labels.filter((item) => item.path === "reference").map((item) => item.pageNumber)).toEqual([1, document.pages.length - 1]);
  });
});

describe("react-pdf pagination modes", () => {
  it("labels the same fields with the new pagination engine and in a page layout's repeated chrome", async () => {
    const sample = await statementModel.sample({ seed: 5 });
    const table = (Field: FieldComponent<Statement>) =>
      sample.value.rows.map((row, index) => (
        <View key={index} wrap={false} style={{ flexDirection: "row" }}>
          <Field path={`rows[${index}].plate`} style={{ width: 120 }}>{row.plate}</Field>
          <Field path={`rows[${index}].country`}>{row.country}</Field>
        </View>
      ));
    const printed = { ...stress.printed, title: false, code: false, issuedAt: false, customer: false, iban: false, totalCents: false, terms: false, contact: false, summary: false, rows: { items: { plate: true, country: true, km: false, amountCents: false } } } as const;
    const engine = defineReactTemplate<Statement>()({
      key: "engine",
      family: "statement",
      locale: locales["de-DE"],
      printed,
      render: ({ value, Field }) => (
        <Page experimentalPagination style={{ padding: 40 }}>
          <Field fixed path="reference">{value.reference}</Field>
          {table(Field)}
        </Page>
      ),
    });
    const chrome = defineReactTemplate<Statement>()({
      key: "chrome",
      family: "statement",
      locale: locales["de-DE"],
      printed,
      render: ({ value, Field }) => (
        <Page
          style={{ padding: 40 }}
          layout={({ children, pageNumber }) => (
            <View style={{ flexGrow: 1 }}>
              <Field path="reference">{value.reference}</Field>
              <Text>Seite {pageNumber}</Text>
              <View style={{ flexGrow: 1 }}>{children}</View>
            </View>
          )}
        >
          {table(Field)}
        </Page>
      ),
    });
    for (const template of [engine, chrome]) {
      const rendered = await renderReactPdf(template, sample);
      expect(rendered.pages.length).toBeGreaterThan(1);
      expect(rendered.labels.filter((item) => item.path === "reference").map((item) => item.pageNumber)).toEqual(rendered.pages.map((page) => page.pageNumber));
      expect(rendered.labels.filter((item) => item.path.endsWith(".plate"))).toHaveLength(sample.value.rows.length);
      expect((await verifyLabels(rendered)).failures).toEqual([]);
      expect(boxDeltas(rendered.labels, await spansByPage(rendered.bytes)).unmatched).toEqual([]);
    }
  });
});

describe("text react-pdf moves or transforms", () => {
  it("labels a paragraph react-pdf moves whole to the next page, and an upper-cased value whose letters change", async () => {
    const sample = await statementModel.sample({ seed: 3 });
    const value = { ...sample.value, title: "Abrechnung Straßennutzung", terms: Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ") };
    const printed = { ...stress.printed, reference: false, code: false, issuedAt: false, customer: false, iban: false, totalCents: false, rows: false, contact: false, summary: false } as const;
    const moved = defineReactTemplate<Statement>()({
      key: "moved",
      family: "statement",
      locale: locales["de-DE"],
      printed,
      render: ({ value, Field }) => (
        <Page size="A6" style={{ padding: 20, fontSize: 10 }}>
          <Field path="title" style={{ textTransform: "uppercase" }}>{value.title}</Field>
          <View style={{ height: 355 }} />
          <Field path="terms" style={{ fontSize: 12 }}>{value.terms}</Field>
        </Page>
      ),
    });
    const rendered = await renderReactPdf(moved, { ...sample, value });
    expect(rendered.labels.find((item) => item.path === "title")?.text).toBe("ABRECHNUNG STRASSENNUTZUNG");
    expect(rendered.labels.filter((item) => item.path === "terms").map((item) => item.pageNumber)).toEqual([2]);
    expect((await verifyLabels(rendered)).failures).toEqual([]);
  });
});

describe("React documents in renditions, corpora and eval", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "synthetic-react-eval-"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("degrades a multi-page React document with every label moved onto its page", async () => {
    const scanned = await degrade(document, { profile: "scan", severity: 0.5, dpi: 100 });
    expect(scanned.pages.map((page) => page.pageNumber)).toEqual(document.pages.map((page) => page.pageNumber));
    expect(scanned.labels.map((item) => [item.path, item.pageNumber])).toEqual(document.labels.map((item) => [item.path, item.pageNumber]));
    for (const item of scanned.labels) {
      const page = scanned.pages[item.pageNumber - 1];
      expect(item.box.x).toBeGreaterThanOrEqual(0);
      expect(right(item.box)).toBeLessThanOrEqual((page?.width ?? 0) + 0.5);
      expect(bottom(item.box)).toBeLessThanOrEqual((page?.height ?? 0) + 0.5);
    }
    expect(scanned.expected).toEqual(document.expected);
  }, 60_000);

  it("writes a corpus whose cases eval scores and grounds, and reads each printed string back from its box", async () => {
    const report = await writeCorpus(directory, {
      model: statementModel,
      templates: [stress],
      seeds: [1, 2],
      renditions: [digital(), scan({ severity: 0.3, dpi: 100 }), photo({ severity: 0.3, dpi: 100 })],
    });
    expect([report.written, report.failed]).toEqual([6, []]);
    const cases = await jsonlDataset(report.manifest).cases();
    expect(cases.map((item) => item.tags?.["rendition"]).sort()).toEqual(["digital", "digital", "photo", "photo", "scan", "scan"]);

    let labelled = 0;
    for (const item of cases) {
      const labels = JSON.parse(await readFile(join(directory, "cases", item.id, "labels.json"), "utf8")) as FieldLabel[];
      expect(item.locations).toEqual(locationsOf(labels));
      labelled += new Set(labels.map((label) => label.path)).size;
    }
    const result = await runEval({
      dataset: jsonlDataset(report.manifest),
      spec: looseEval(),
      experiments: {
        oracle: {
          id: "oracle",
          async extract(item) {
            const evidence = Object.entries(item.locations ?? {}).flatMap(([path, places]) => places.map((place) => ({ path, ...place })));
            return { raw: item.expected, evidence };
          },
        },
        // Read the digital text layer inside each expected box: printed strings must come back exactly.
        "text-layer": {
          id: "text-layer",
          async extract(item) {
            const expected = item.expected as Record<string, unknown>;
            if (item.tags?.["rendition"] !== "digital") return { raw: expected };
            const pages = await spansByPage(await (item.documents[0]?.bytes() ?? Promise.resolve(new Uint8Array())));
            const read = (path: string): string =>
              (item.locations?.[path] ?? []).map((place) => (pages.get(place.pageNumber) ?? []).filter((span) => place.box !== undefined && overlaps(span, place.box)).map((span) => span.text).join(" ")).join(" ").replace(/\s+/gu, " ").trim();
            const customer = expected["customer"] as Record<string, unknown>;
            const rows = expected["rows"] as Record<string, unknown>[];
            return {
              raw: {
                ...expected,
                reference: read("reference").split(" ")[0],
                customer: { ...customer, name: read("customer.name").split(" ").slice(0, String(customer["name"]).split(" ").length).join(" "), city: read("customer.city") },
                rows: rows.map((row, index) => ({ ...row, plate: read(`rows[${index}].plate`), country: read(`rows[${index}].country`) })),
              },
            };
          },
        },
      },
      sections: [groundingSection()],
    });
    expect(result.summary["oracle"]?.cases).toEqual({ total: 6, scored: 6, errored: 0, skipped: 0 });
    expect(result.summary["oracle"]?.overall).toMatchObject({ exactRate: 1, f1: 1 });
    expect(result.summary["text-layer"]?.overall).toMatchObject({ exactRate: 1, f1: 1 });
    expect(result.grounding?.experiments["oracle"]?.overall).toMatchObject({ labelled, grounded: labelled, hallucinated: 0, groundedF1: 1 });
  }, 120_000);
});
