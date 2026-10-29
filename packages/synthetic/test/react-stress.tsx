import { readFileSync } from "node:fs";
import { Circle, Image, Link, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { defineModel, gen, locales, typedJsonSchema } from "../src/index.js";
import { defineReactTemplate, type FieldComponent } from "../src/react-pdf/index.js";

/** A statement shaped like real paperwork: header block, measured coordinates, a long table and terms. */
export interface Statement {
  readonly reference: string;
  readonly title: string;
  readonly code: string;
  readonly issuedAt: string;
  readonly customer: { readonly name: string; readonly number: string; readonly street: string; readonly city: string };
  readonly iban: string;
  readonly totalCents: number;
  readonly rows: readonly { readonly plate: string; readonly country: string; readonly km: number; readonly amountCents: number }[];
  readonly terms: string;
  readonly contact: string;
  readonly summary: string;
}

const Schema = typedJsonSchema<Statement>({
  type: "object",
  required: ["reference", "title", "code", "issuedAt", "customer", "iban", "totalCents", "rows", "terms", "contact", "summary"],
  properties: {
    reference: { type: "string" },
    title: { type: "string" },
    code: { type: "string" },
    issuedAt: { type: "string" },
    customer: {
      type: "object",
      required: ["name", "number", "street", "city"],
      properties: { name: { type: "string" }, number: { type: "string" }, street: { type: "string" }, city: { type: "string" } },
    },
    iban: { type: "string" },
    totalCents: { type: "integer" },
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["plate", "country", "km", "amountCents"],
        properties: { plate: { type: "string" }, country: { type: "string" }, km: { type: "integer" }, amountCents: { type: "integer" } },
      },
    },
    terms: { type: "string" },
    contact: { type: "string" },
    summary: { type: "string" },
  },
});

const SENTENCE = "Die Mautaufstellung listet alle Fahrten des Abrechnungszeitraums mit Kennzeichen, Strecke und Betrag.";

export const statementModel = defineModel(Schema, {
  fields: {
    reference: gen.pattern("MA-####-######"),
    title: gen.pick(["Mautaufstellung", "Abrechnung Straßennutzung"]),
    code: gen.pattern("??-####"),
    issuedAt: gen.date({ from: "2025-01-01", to: "2025-12-31" }),
    "customer.name": gen.pick(["Nordwind Logistik GmbH", "Spedition Öztürk & Söhne KG", "Kestrel Freight Sp. z o.o."]),
    "customer.number": gen.pattern("#########"),
    "customer.street": gen.pick(["Hafenstraße 12", "Am Güterbahnhof 3a", "Industrieweg 140"]),
    "customer.city": gen.pick(["20457 Hamburg", "44137 Dortmund", "90402 Nürnberg"]),
    iban: gen.iban("DE"),
    rows: gen.array({ length: [55, 70] }),
    "rows[].plate": gen.pattern("HH-??-####"),
    "rows[].country": gen.pick(["D", "PL", "CZ", "NL"]),
    "rows[].km": gen.int(2, 480),
    "rows[].amountCents": gen.int(-4_000, 90_000),
    terms: gen.pick([Array.from({ length: 14 }, () => SENTENCE).join(" ")]),
    contact: gen.pick(["Kundenservice 0800 222 2628"]),
    summary: gen.pick(["Zusammenfassung der Fahrten"]),
  },
  derive: (value) => ({ ...value, totalCents: value.rows.reduce((sum, row) => sum + row.amountCents, 0) }),
});

const geist = new Uint8Array(readFileSync(new URL("../../../brand/fonts/geist-400.ttf", import.meta.url)));
const geistSemi = new Uint8Array(readFileSync(new URL("../../../brand/fonts/geist-600.ttf", import.meta.url)));
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const s = StyleSheet.create({
  page: { paddingTop: 140, paddingBottom: 60, paddingHorizontal: 50, fontFamily: "Geist", fontSize: 9, color: "#222" },
  footer: { position: "absolute", bottom: 24, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#666" },
  boxed: { borderWidth: 2, borderColor: "#333", padding: 8, marginBottom: 10 },
  inner: { padding: 4, borderLeftWidth: 3, borderColor: "#999" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
  cell: { width: "33.33%", paddingVertical: 2 },
  head: { flexDirection: "row", backgroundColor: "#e4e4e4", paddingVertical: 3, fontWeight: 600 },
  row: { flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.25, borderColor: "#bbb" },
  plate: { width: 110, paddingLeft: 4 },
  country: { width: 40, textAlign: "center" },
  km: { width: 60, textAlign: "right" },
  amount: { flexGrow: 1, flexBasis: 0, textAlign: "right", paddingRight: 4 },
});

/** `<At>` from measured layouts: the text box placed at an absolute reading, right-aligned in a wide box when `right` is given. */
function At({ Field, path, x, right, y, size, children }: { Field: FieldComponent<Statement>; path: Parameters<FieldComponent<Statement>>[0]["path"]; x?: number; right?: number; y: number; size: number; children: string }) {
  const top = y - 0.182 * size;
  const style = right === undefined ? { position: "absolute" as const, top, left: x ?? 0, fontSize: size, lineHeight: 1 } : { position: "absolute" as const, top, left: right - 260, width: 260, textAlign: "right" as const, fontSize: size, lineHeight: 1 };
  return (
    <Field path={path} style={style}>
      {children}
    </Field>
  );
}

export const stress = defineReactTemplate<Statement>()({
  key: "react-stress",
  family: "statement",
  locale: locales["de-DE"],
  fonts: [
    { family: "Geist", src: geist },
    { family: "Geist", src: geistSemi, fontWeight: 600 },
  ],
  printed: {
    reference: true,
    title: true,
    code: true,
    issuedAt: true,
    customer: { name: true, number: true, street: true, city: true },
    iban: true,
    totalCents: true,
    rows: { items: { plate: true, country: true, km: true, amountCents: true } },
    terms: true,
    contact: true,
    summary: true,
  },
  render: ({ value, format, Field }) => [
    <Page key="main" size="A4" style={s.page}>
      <Svg fixed width={60} height={24} style={{ position: "absolute", top: 30, left: 50 }}>
        <Rect x={0} y={0} width={24} height={24} fill="#0a5" />
        <Circle cx={42} cy={12} r={10} fill="#05a" />
      </Svg>
      <Image fixed src={PIXEL} style={{ position: "absolute", top: 30, right: 50, width: 24, height: 24 }} />
      <At Field={Field} path="customer.number" x={70.92} y={70.5} size={9}>
        {value.customer.number}
      </At>
      <At Field={Field} path="reference" right={545.28} y={70.5} size={9}>
        {value.reference}
      </At>
      <Field path="title" style={{ position: "absolute", top: 95, left: 50, fontSize: 18, fontWeight: 600, textTransform: "uppercase" }}>
        {value.title}
      </Field>
      <View style={s.boxed}>
        <View style={s.inner}>
          <Field path="customer.name" style={{ fontSize: 11, fontWeight: 600, padding: 3, borderWidth: 1, borderColor: "#ccc" }}>
            {value.customer.name}
          </Field>
          <Field path="customer.street">{value.customer.street}</Field>
          <Field path="customer.city">{value.customer.city}</Field>
        </View>
      </View>
      <View style={s.grid}>
        <View style={s.cell}>
          <Text>Datum</Text>
          <Field path="issuedAt">{format.date(value.issuedAt)}</Field>
        </View>
        <View style={s.cell}>
          <Text>Code</Text>
          <Field path="code" style={{ letterSpacing: 1.5 }}>
            {value.code}
          </Field>
        </View>
        <View style={[s.cell, { alignItems: "flex-end" }]}>
          <Text>IBAN</Text>
          <Link src="https://example.com/pay">
            <Field path="iban" style={{ fontSize: 8 }}>
              {value.iban}
            </Field>
          </Link>
        </View>
      </View>
      <View render={() => <Field path="summary" style={{ fontSize: 10, marginBottom: 6 }}>{value.summary}</Field>} />
      <View fixed style={[s.head, { marginTop: 4 }]}>
        <Text style={s.plate}>Kennzeichen</Text>
        <Text style={s.country}>Land</Text>
        <Text style={s.km}>km</Text>
        <Text style={s.amount}>Betrag</Text>
      </View>
      {value.rows.map((row, index) => (
        <View key={index} wrap={false} style={s.row}>
          <Field path={`rows[${index}].plate`} style={s.plate}>{row.plate}</Field>
          <Field path={`rows[${index}].country`} style={s.country}>{row.country}</Field>
          <Field path={`rows[${index}].km`} style={s.km}>{format.number(row.km)}</Field>
          <Field path={`rows[${index}].amountCents`} style={s.amount}>{format.money(row.amountCents)}</Field>
        </View>
      ))}
      <View wrap={false} style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8, fontWeight: 600 }}>
        <Text style={{ marginRight: 12 }}>Gesamt</Text>
        <Field path="totalCents" style={{ fontWeight: 600 }}>{format.money(value.totalCents)}</Field>
      </View>
      <Field path="terms" orphans={2} widows={2} style={{ marginTop: 300, textAlign: "justify", lineHeight: 1.6 }}>
        {value.terms}
      </Field>
      <View fixed style={s.footer}>
        <Field path="contact">{value.contact}</Field>
        <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
      </View>
    </Page>,
    <Page key="landscape" size="A4" orientation="landscape" style={{ padding: 40, fontFamily: "Geist" }}>
      <Text style={{ fontSize: 14 }}>Anlage</Text>
      <View style={{ position: "absolute", right: 40, bottom: 40 }}>
        <Field path="reference">{value.reference}</Field>
      </View>
    </Page>,
    <Page key="a5" size="A5" style={{ padding: 30, fontFamily: "Helvetica" }}>
      <Field path="customer.name" style={{ textAlign: "center", fontSize: 12 }}>
        {value.customer.name}
      </Field>
    </Page>,
  ],
});
