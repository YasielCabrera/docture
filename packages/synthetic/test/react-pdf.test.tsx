import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Image, Page, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { defineModel, gen, locales, prints, scenario, TemplateError, toEvalCase, typedJsonSchema, type Formatter } from "../src/index.js";
import { digital, writeCorpus } from "../src/node/index.js";
import { renderTemplate } from "../src/pdfkit/index.js";
import { defineReactTemplate, Field, renderReactPdf, type FieldComponent } from "../src/react-pdf/index.js";
import { verifyLabels } from "../src/verify/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const geist = new Uint8Array(readFileSync(new URL("../../../brand/fonts/geist-400.ttf", import.meta.url)));

function LineItems({ value, format, Field }: { value: Invoice; format: Formatter; Field: FieldComponent<Invoice> }) {
  return (
    <View style={{ marginTop: 24 }}>
      <View fixed style={{ flexDirection: "row", borderBottomWidth: 0.5, paddingBottom: 3, fontFamily: "Helvetica-Bold" }}>
        <Text style={{ width: 35 }}>Pos.</Text>
        <Text style={{ flexGrow: 1 }}>Beschreibung</Text>
        <Text style={{ width: 50, textAlign: "right" }}>Menge</Text>
        <Text style={{ width: 90, textAlign: "right" }}>Betrag</Text>
      </View>
      {value.lineItems.map((item, index) => (
        <View key={index} wrap={false} style={{ flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: "#999" }}>
          <Text style={{ width: 35 }}>{index + 1}</Text>
          <Field path={`lineItems[${index}].description`} style={{ flexGrow: 1, flexBasis: 0 }}>{item.description}</Field>
          <Field path={`lineItems[${index}].quantity`} style={{ width: 50, textAlign: "right" }}>{format.number(item.quantity)}</Field>
          <Field path={`lineItems[${index}].amountCents`} style={{ width: 90, textAlign: "right" }}>{format.money(item.amountCents)}</Field>
        </View>
      ))}
    </View>
  );
}

const invoice = defineReactTemplate<Invoice>()({
  key: "react-invoice",
  aliases: ["react"],
  family: "invoice",
  tags: { engine: "react-pdf" },
  locale: locales["de-DE"],
  fonts: [{ family: "Geist", src: geist }],
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
  render: ({ value, format, Field }) => (
    <Page size="A4" style={{ padding: 50, fontFamily: "Geist", fontSize: 9 }}>
      <Field fixed path="invoiceNumber" style={{ position: "absolute", top: 20, right: 50, fontSize: 7 }}>{value.invoiceNumber}</Field>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontSize: 20, fontFamily: "Helvetica-Bold" }}>RECHNUNG</Text>
          <Field path="seller.name" style={{ fontSize: 11, marginTop: 8 }}>{value.seller.name}</Field>
          {value.seller.vatId === undefined ? null : <Field path="seller.vatId">USt-IdNr. {value.seller.vatId}</Field>}
        </View>
        <View style={{ width: 160 }}>
          <Field path="issuedAt" style={{ textAlign: "right" }}>{format.date(value.issuedAt)}</Field>
          <Field path="dueAt" style={{ textAlign: "right" }}>{format.date(value.dueAt)}</Field>
        </View>
      </View>
      <View style={{ marginTop: 24 }}>
        <Field path="buyer.name">{value.buyer.name}</Field>
        {value.buyer.contact === undefined ? null : <Field path="buyer.contact">z. Hd. {value.buyer.contact}</Field>}
      </View>
      <LineItems value={value} format={format} Field={Field} />
      <View wrap={false} style={{ marginTop: 12, marginLeft: "auto", width: 200 }}>
        {(
          [
            ["Zwischensumme", "subtotalCents"],
            ["USt. 19 %", "taxCents"],
            ["Gesamt", "totalCents"],
          ] as const
        ).map(([label, path]) => (
          <View key={path} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text>{label}</Text>
            <Field path={path}>{format.money(value[path])}</Field>
          </View>
        ))}
        <Field path="paymentMethod">{value.paymentMethod === "card" ? "Kartenzahlung" : "Überweisung"}</Field>
        <Field path="seller.iban">IBAN {value.seller.iban}</Field>
      </View>
      {value.note === null ? null : (
        <Field path="note" style={{ marginTop: 12, width: 160 }}>
          {value.note}
        </Field>
      )}
    </Page>
  ),
});

const many = scenario<Invoice>({ name: "many-lines", fields: { lineItems: gen.array({ length: 45 }) } });

async function pdfText(bytes: Uint8Array) {
  const loaded = await new DocumentLoaderPdfJs().load({ bytes, mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
  return loaded.pages;
}

describe("renderReactPdf", () => {
  it("labels every <Field> with the box of its laid-out text, and verification reads each label back", async () => {
    const sample = await invoiceModel.sample({ seed: 4 });
    const doc = await renderReactPdf(invoice, sample);

    expect(new TextDecoder().decode(doc.bytes.slice(0, 5))).toBe("%PDF-");
    expect(doc.pages).toEqual([{ pageNumber: 1, width: expect.closeTo(595.28, 2), height: expect.closeTo(841.89, 2) }]);
    expect(doc.provenance).toMatchObject({ renderer: "react-pdf", reactPdf: "4.9.0", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(doc.template).toEqual({ key: "react-invoice", family: "invoice", tags: { engine: "react-pdf", locale: "de-DE" } });
    expect(await verifyLabels(doc)).toEqual({ ok: true, checked: doc.labels.length, failures: [] });

    const label = (path: string) => doc.labels.find((item) => item.path === path);
    expect(label("invoiceNumber")?.text).toBe(sample.value.invoiceNumber);
    expect(label("totalCents")?.text).toMatch(/^[\d.]+,\d\d €$/u);
    expect(label("lineItems[0].amountCents")?.value).toBe(sample.value.lineItems[0]?.amountCents);
    expect(doc.expected).toMatchObject({ currency: null, lineItems: sample.value.lineItems.map(() => ({ unitPriceCents: null })) });

    // The right-aligned date ends at the right edge of its 160pt column, which ends at the page margin.
    const issued = label("issuedAt")?.box;
    expect((issued?.x ?? 0) + (issued?.width ?? 0)).toBeCloseTo(595.28 - 50, 1);
    const spans = (await pdfText(doc.bytes))[0]?.lines?.flatMap((line) => line.spans) ?? [];
    const span = spans.find((item) => item.text === label("issuedAt")?.text);
    expect([span?.x, span?.width]).toEqual([expect.closeTo(issued?.x ?? 0, 1), expect.closeTo(issued?.width ?? 0, 1)]);

    expect(toEvalCase(doc).locations["seller.name"]).toEqual([{ pageNumber: 1, box: label("seller.name")?.box }]);
  });

  it("labels rows on every page a long table wraps onto, and a fixed field once per page", async () => {
    const sample = await invoiceModel.sample({ seed: 2, scenario: many });
    const doc = await renderReactPdf(invoice, sample);

    expect(doc.pages.length).toBeGreaterThan(1);
    expect((await verifyLabels(doc)).failures).toEqual([]);
    expect(doc.labels.filter((label) => label.path === "invoiceNumber").map((label) => label.pageNumber)).toEqual(doc.pages.map((page) => page.pageNumber));
    const rows = doc.labels.filter((label) => /^lineItems\[\d+\]\.amountCents$/u.test(label.path));
    expect(rows).toHaveLength(45);
    expect(new Set(rows.map((row) => row.pageNumber)).size).toBeGreaterThan(1);
    expect(doc.labels.find((label) => label.path === "totalCents")?.pageNumber).toBe(doc.pages.length);
  });

  it("produces byte-identical PDFs for equal samples, and a different date changes only the metadata", async () => {
    const sample = await invoiceModel.sample({ seed: 9 });
    const first = await renderReactPdf(invoice, sample);
    const second = await renderReactPdf(invoice, await invoiceModel.sample({ seed: 9 }));
    expect(sha(second.bytes)).toBe(sha(first.bytes));
    const dated = await renderReactPdf(invoice, sample, { createdAt: "2026-03-01T00:00:00Z" });
    expect(sha(dated.bytes)).not.toBe(sha(first.bytes));
    expect(dated.labels).toEqual(first.labels);
    await expect(renderReactPdf(invoice, sample, { createdAt: "soon" })).rejects.toThrow(RangeError);
  });

  it("renders concurrent samples to the same bytes and labels as one at a time", async () => {
    const samples = await Promise.all([1, 2, 3, 4, 5, 6].map((seed) => invoiceModel.sample({ seed })));
    const together = await Promise.all(samples.map((sample) => renderReactPdf(invoice, sample)));
    for (const [index, sample] of samples.entries()) {
      const alone = await renderReactPdf(invoice, sample);
      expect(sha(together[index]?.bytes ?? new Uint8Array())).toBe(sha(alone.bytes));
      expect(together[index]?.labels).toEqual(alone.labels);
    }
  });

  it("labels one value printed for several paths, waits for an async render, and keeps words whole", async () => {
    const Pair = typedJsonSchema<{ code: string; reference: string; note: string }>({
      type: "object",
      required: ["code", "reference", "note"],
      properties: { code: { type: "string" }, reference: { type: "string" }, note: { type: "string" } },
    });
    const model = defineModel(Pair, { fields: { code: gen.pick(["AB-0001"]), reference: gen.pick(["AB-0001"]), note: gen.pick(["Überweisungsträger Rechnungsnummer Kundennummer"]) } });
    const template = defineReactTemplate<{ code: string; reference: string; note: string }>()({
      key: "pair",
      family: "pair",
      locale: locales["de-DE"],
      printed: { code: true, reference: true, note: true },
      async render({ value, Field }) {
        const pixel = await Promise.resolve("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
        return (
          <Page size="A5" style={{ padding: 40 }}>
            <Image src={pixel} style={{ width: 10, height: 10 }} />
            <Field path={["code", "reference"]}>{value.code}</Field>
            <Field path="note" style={{ width: 80 }}>{value.note}</Field>
          </Page>
        );
      },
    });
    const sample = await model.sample({ seed: 1 });
    const doc = await renderReactPdf(template, sample);
    expect(doc.labels.filter((label) => label.text === "AB-0001").map((label) => label.path)).toEqual(["code", "reference"]);
    expect(doc.labels.find((label) => label.path === "note")?.text).toBe("Überweisungsträger\nRechnungsnummer\nKundennummer");
    expect((await verifyLabels(doc)).failures).toEqual([]);
  });

  it("rejects fields that disagree with the printed mask, glyphs the font lacks, and fields that cannot be boxed", async () => {
    const Simple = typedJsonSchema<{ a: string; b: string }>({ type: "object", required: ["a", "b"], properties: { a: { type: "string" }, b: { type: "string" } } });
    const model = defineModel(Simple, { fields: { a: gen.pick(["Ω ≠ ok"]), b: gen.pick(["bee"]) } });
    const sample = await model.sample({ seed: 1 });
    const problems = async (render: (props: { value: { a: string; b: string }; Field: FieldComponent<{ a: string; b: string }> }) => ReactNode, printed = { a: true, b: false } as const) => {
      const template = defineReactTemplate<{ a: string; b: string }>()({ key: "bad", family: "bad", locale: locales["en-US"], printed, render });
      const error = await renderReactPdf(template, sample).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TemplateError);
      return (error as TemplateError).problems.map((problem) => [problem.code, problem.path]);
    };

    expect(await problems(({ value, Field }) => (
      <Page>
        <Field path="b">{value.b}</Field>
      </Page>
    ))).toEqual([["undeclared-field", "b"], ["unprinted-field", "a"]]);
    expect(await problems(({ value, Field }) => (
      <Page>
        <Field path="a">{value.a}</Field>
        <Text>Total ✓</Text>
      </Page>
    ))).toEqual([["missing-glyph", "a"], ["missing-glyph", "(text)"]]);
    expect(await problems(({ Field }) => (
      <Page>
        <Text>
          Label <Field path="a">x</Field>
        </Text>
      </Page>
    ))).toEqual([["invalid-template", "a"], ["unprinted-field", "a"]]);
    expect(await problems(({ Field }) => (
      <Page>
        <View style={{ transform: "rotate(90deg)" }}>
          <Field path="a">x</Field>
        </View>
      </Page>
    ))).toEqual([["invalid-template", "a"], ["unprinted-field", "a"]]);
    expect(await problems(({ Field }) => (
      <Page>
        <Field path="a" style={{ position: "absolute", left: 590 }}>far right</Field>
      </Page>
    ))).toEqual([["invalid-template", "a"]]);
    expect(await problems(({ Field }) => (
      <Page>
        <Field path="a" style={{ display: "none" }}>hidden</Field>
      </Page>
    ))).toEqual([["invalid-template", "a"], ["unprinted-field", "a"]]);
    // react-pdf drops lines that do not fit a fixed height or maxLines; a field with no line left has no label either.
    const cases: [ReactNode, string[][]][] = [
      [
        <View style={{ height: 14 }}>
          <Field<{ a: string; b: string }> path="a" style={{ width: 40, fontSize: 10 }}>a value that wraps onto lines</Field>
        </View>,
        [["invalid-template", "a"]],
      ],
      [<Field<{ a: string; b: string }> path="a" style={{ width: 60, fontSize: 10, maxLines: 1, textOverflow: "ellipsis" }}>a value that wraps onto lines</Field>, [["invalid-template", "a"]]],
      [
        <View style={{ height: 14, overflow: "hidden" }}>
          <Field<{ a: string; b: string }> path="a" style={{ fontSize: 10, lineHeight: 2 }}>tall</Field>
        </View>,
        [["invalid-template", "a"], ["unprinted-field", "a"]],
      ],
    ];
    for (const [cut, expected] of cases) expect(await problems(() => <Page style={{ padding: 20 }}>{cut}</Page>)).toEqual(expected);
    expect(await problems(() => {
      throw new Error("no layout today");
    })).toEqual([["invalid-template", ""]]);
  });

  it("explains a returned <Document>, a font family redefined with other faces, and <Field> before any render", async () => {
    const { Document } = await import("@react-pdf/renderer");
    const model = defineModel(typedJsonSchema<{ a: string }>({ type: "object", required: ["a"], properties: { a: { type: "string" } } }), { fields: { a: gen.pick(["x"]) } });
    const sample = await model.sample({ seed: 1 });
    const define = (key: string, fonts: { family: string; src: string }[] = []) =>
      defineReactTemplate<{ a: string }>()({
        key,
        family: "doc",
        locale: locales["en-US"],
        printed: { a: true },
        fonts,
        render: ({ value, Field }) =>
          key === "whole" ? (
            <Document>
              <Page>
                <Field path="a">{value.a}</Field>
              </Page>
            </Document>
          ) : (
            <Page>
              <Field path="a">{value.a}</Field>
            </Page>
          ),
      });

    await expect(renderReactPdf(define("whole"), sample)).rejects.toThrow(/returns a <Document>; return <Page> elements/u);
    await renderReactPdf(define("first", [{ family: "Clash", src: "Helvetica" }]), sample);
    await renderReactPdf(define("again", [{ family: "Clash", src: "Helvetica" }]), sample);
    await expect(renderReactPdf(define("second", [{ family: "Clash", src: "Courier" }]), sample)).rejects.toThrow(/font family "Clash" with other faces/u);

    vi.resetModules();
    const fresh = await import("../src/react-pdf/index.js");
    expect(() => fresh.Field({ path: "a", children: "x" })).toThrow(/<Field> renders inside renderReactPdf/u);
  });
});

describe("fields that layout moves, pads or cannot label", () => {
  type One = { a: string; b: string };
  const model = defineModel(typedJsonSchema<One>({ type: "object", required: ["a", "b"], properties: { a: { type: "string" }, b: { type: "string" } } }), { fields: { a: gen.pick(["x"]), b: gen.pick(["y"]) } });
  const render = async (render: (props: { Field: FieldComponent<One> }) => ReactNode, options: { fonts?: { family: string; src: string | Uint8Array }[]; key?: string } = {}) => {
    const template = defineReactTemplate<One>()({ key: options.key ?? "edge", family: "edge", locale: locales["en-US"], printed: { a: true, b: false }, fonts: options.fonts ?? [], render });
    return renderReactPdf(template, await model.sample({ seed: 1 }));
  };
  const messages = (error: unknown) => (error instanceof TemplateError ? error.problems.map((problem) => `${problem.code} ${problem.path}: ${problem.message}`) : [String(error)]);

  it("ends a box at the glyphs, not the line spacing, and starts it after hanging leading spaces", async () => {
    const tall = await render(({ Field }) => (
      <Page style={{ padding: 20, fontSize: 10 }}>
        <Field path="a" style={{ lineHeight: 4 }}>{"   tall"}</Field>
      </Page>
    ));
    const box = tall.labels[0]?.box;
    expect(tall.labels[0]?.text).toBe("tall");
    // react-pdf hangs the leading spaces left of the padding, so the glyphs start at the padding.
    expect(box?.x).toBeCloseTo(20, 1);
    expect(box?.height).toBeCloseTo(11, 1);
    expect((await verifyLabels(tall)).failures).toEqual([]);
  });

  it("moves a label with translate(), verifies letter-spaced text with spaces, and ignores a family that is not a string", async () => {
    const doc = await render(({ Field }) => (
      <Page style={{ padding: 20, fontSize: 10, fontFamily: Number.NaN as unknown as string }}>
        <View style={{ transform: "translate(30, 12)" }}>
          <View style={{ transform: "translateY(8)" }}>
            <Field path="a" style={{ letterSpacing: 2 }}>DE88 3005 0000</Field>
          </View>
        </View>
      </Page>
    ));
    expect(doc.labels[0]?.box.x).toBeCloseTo(50, 1);
    expect(doc.labels[0]?.box.y).toBeCloseTo(40, 1);
    expect((await verifyLabels(doc)).failures).toEqual([]);
    const spans = (await pdfText(doc.bytes))[0]?.lines?.flatMap((line) => line.spans) ?? [];
    expect(Math.min(...spans.map((span) => span.x))).toBeCloseTo(50, 1);
  });

  it("follows a split text by its element, so a fixed copy of the same text does not interrupt it", async () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    const doc = await render(({ Field }) => (
      <Page size="A6" style={{ padding: 20, paddingBottom: 40, fontSize: 12 }}>
        <View style={{ height: 300 }} />
        <Field path="a">{long}</Field>
        <Field fixed path="a" style={{ position: "absolute", bottom: 10, left: 20, fontSize: 6 }}>{long.slice(0, 20)}</Field>
      </Page>
    ));
    expect(new Set(doc.labels.map((label) => label.pageNumber)).size).toBeGreaterThan(1);
  });

  it("names what it cannot label: right-to-left text, Svg text, an empty path list and a nested <Document>", async () => {
    const { Document, Svg } = await import("@react-pdf/renderer");
    const cases: [(props: { Field: FieldComponent<One> }) => ReactNode, RegExp][] = [
      [({ Field }) => <Page><Field path="a">שלום עולם</Field></Page>, /a: contains right-to-left text/u],
      [({ Field }) => <Page><Svg width={100} height={40}><Field path="a">x</Field></Svg></Page>, /a: is inside <Svg>/u],
      [({ Field }) => <Page><Field path={[]}>x</Field></Page>, /: has an empty path list/u],
      [({ Field }) => [<Document key="d"><Page><Field path="a">x</Field></Page></Document>], /returns a <Document>/u],
    ];
    for (const [template, expected] of cases) {
      const error = await render(template).catch((caught: unknown) => caught);
      expect(messages(error).some((message) => expected.test(message)), messages(error).join("\n")).toBe(true);
    }
  });

  it("checks spaces the font cannot draw and fonts the template does not declare", async () => {
    const narrow = await render(({ Field }) => <Page><Field path="a">{"1\u202F234,50 €"}</Field></Page>).catch((caught: unknown) => caught);
    expect(messages(narrow)).toEqual([expect.stringMatching(/^missing-glyph a: font "Helvetica" cannot draw ".+" \(U\+202F\)$/u)]);

    const standard = await render(({ Field }) => <Page><Field path="a">x</Field></Page>, { fonts: [{ family: "Helvetica", src: "Courier" }] }).catch((caught: unknown) => caught);
    expect(messages(standard)[0]).toMatch(/registers font family "Helvetica", which react-pdf already has/u);

    await render(({ Field }) => <Page><Field path="a" style={{ fontFamily: "Shared" }}>x</Field></Page>, { fonts: [{ family: "Shared", src: "Courier" }], key: "declares" });
    const borrowing = await render(({ Field }) => <Page><Field path="a" style={{ fontFamily: "Shared" }}>x</Field></Page>, { key: "borrows" }).catch((caught: unknown) => caught);
    expect(messages(borrowing)).toEqual(['invalid-template : uses font family "Shared" without declaring it in fonts; react-pdf families are process-wide, so the template would render only after another template registers it']);
  });
});

describe("<Field> paths", () => {
  it("accepts the template's concrete paths and rejects others at compile time", () => {
    const typed = (value: Invoice, TypedField: FieldComponent<Invoice>) => [
      <TypedField path="totalCents">{value.totalCents}</TypedField>,
      <TypedField path={["seller.name", "buyer.name"]}>{value.seller.name}</TypedField>,
      <Field<Invoice> path={`lineItems[${0}].amountCents`}>x</Field>,
      // @ts-expect-error a misspelled path is rejected
      <TypedField path="totalCent">x</TypedField>,
      // @ts-expect-error a pattern is not a concrete path
      <Field<Invoice> path="lineItems[].amountCents">x</Field>,
    ];
    // A module-level alias types every component of a deep tree without passing Field down.
    const InvoiceField: FieldComponent<Invoice> = Field;
    const aliased = [
      <InvoiceField path="seller.iban">x</InvoiceField>,
      // @ts-expect-error the alias keeps path checking
      <InvoiceField path="seller.ibn">x</InvoiceField>,
    ];
    void aliased;
    expect(typed).toBeTypeOf("function");
  });
});

describe("React templates in corpora", () => {
  it("renderTemplate and writeCorpus render a React template beside PDFKit templates", async () => {
    const sample = await invoiceModel.sample({ seed: 3 });
    expect((await renderTemplate(invoice, sample)).provenance).toMatchObject({ renderer: "react-pdf" });

    const directory = await mkdtemp(join(tmpdir(), "synthetic-react-corpus-"));
    try {
      const report = await writeCorpus(directory, { model: invoiceModel, templates: [invoice], seeds: [1, 2], renditions: [digital()] });
      expect([report.written, report.failed]).toEqual([2, []]);
      const rerun = await writeCorpus(directory, { model: invoiceModel, templates: [invoice], seeds: [1, 2], renditions: [digital()] });
      expect([rerun.written, rerun.skipped]).toEqual([0, 2]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
