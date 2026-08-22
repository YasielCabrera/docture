/**
 * Deterministic synthetic invoices: a real PDF with a real text layer, paired with
 * the ground truth that produced it.
 *
 * Why generate rather than commit fixtures: extraction is usually tested against
 * documents that are confidential, which makes a corpus impossible to ship and
 * impossible to review. A generated document is public, diffable, and its expected
 * output cannot drift from the bytes — the same values wrote both.
 *
 * Deterministic on purpose: `seed` fully determines the document, so a failure is
 * reproducible and `seed: 7` means the same invoice on every machine, forever.
 */

import PDFDocument from "pdfkit";

export interface SyntheticLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
}

/** The ground truth. Exactly what a correct extraction should return. */
export interface SyntheticInvoice {
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly dueAt: string;
  readonly currency: string;
  readonly sellerName: string;
  readonly buyerName: string;
  readonly lineItems: readonly SyntheticLineItem[];
  readonly subtotal: number;
  readonly taxRate: number;
  readonly tax: number;
  readonly total: number;
}

export interface SyntheticDocument<T> {
  readonly bytes: Uint8Array;
  readonly expected: T;
  /** How many pages the PDF actually has. */
  readonly pageCount: number;
}

export interface InvoiceOptions {
  /** Same seed → byte-comparable document and identical ground truth. */
  readonly seed?: number;
  /** Number of line items. Enough of them spills onto a second page. */
  readonly lineItemCount?: number;
  /** Emit no text at all, to stand in for a scanned document. */
  readonly textless?: boolean;
}

/** mulberry32 — small, fast, and identical across platforms. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  "Hydraulic coupling",
  "Steel bracket, galvanised",
  "Bearing assembly",
  "Drive belt 1200mm",
  "Control module",
  "Sealing ring set",
  "Pressure sensor",
  "Mounting plate",
  "Cable harness",
  "Filter cartridge",
] as const;

const SELLERS = ["Northwind Industrial GmbH", "Kestrel Components Ltd", "Meridian Supply BV"] as const;
const BUYERS = ["Arclight Manufacturing SA", "Trellis Logistics AG", "Pinnacle Works Oy"] as const;

/** Two decimals, without the float dust that breaks an equality assertion. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  // `values` is always non-empty at every call site; keep the type honest anyway.
  return value ?? (values[0] as T);
}

function isoDate(dayOffset: number): string {
  // A fixed epoch, so the fixture does not change meaning tomorrow.
  const base = Date.UTC(2026, 0, 15);
  return new Date(base + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

export function buildInvoiceData(options: InvoiceOptions = {}): SyntheticInvoice {
  const random = rng(options.seed ?? 1);
  const count = options.lineItemCount ?? 5;

  const lineItems: SyntheticLineItem[] = Array.from({ length: count }, (_, i) => {
    const quantity = 1 + Math.floor(random() * 20);
    const unitPrice = money(5 + random() * 400);
    return {
      description: `${pick(random, PRODUCTS)} #${String(100 + i)}`,
      quantity,
      unitPrice,
      amount: money(quantity * unitPrice),
    };
  });

  const subtotal = money(lineItems.reduce((sum, li) => sum + li.amount, 0));
  const taxRate = 0.19;
  const tax = money(subtotal * taxRate);

  return {
    invoiceNumber: `INV-2026-${String(1000 + Math.floor(random() * 9000))}`,
    issuedAt: isoDate(Math.floor(random() * 60)),
    dueAt: isoDate(60 + Math.floor(random() * 30)),
    currency: "EUR",
    sellerName: pick(random, SELLERS),
    buyerName: pick(random, BUYERS),
    lineItems,
    subtotal,
    taxRate,
    tax,
    total: money(subtotal + tax),
  };
}

/** `1234.56` → `"1,234.56"`, matching what the PDF renders. */
export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderInvoice(doc: PDFKit.PDFDocument, data: SyntheticInvoice): void {
  const left = 50;
  const right = 545;

  doc.font("Helvetica-Bold").fontSize(20).text("INVOICE", left, 50);

  doc.font("Helvetica").fontSize(10);
  doc.text(`Invoice Number: ${data.invoiceNumber}`, left, 90);
  doc.text(`Issue Date: ${data.issuedAt}`, left, 105);
  doc.text(`Due Date: ${data.dueAt}`, left, 120);

  doc.font("Helvetica-Bold").text("From:", left, 150);
  doc.font("Helvetica").text(data.sellerName, left, 165);
  doc.font("Helvetica-Bold").text("To:", 320, 150);
  doc.font("Helvetica").text(data.buyerName, 320, 165);

  let y = 210;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Description", left, y);
  doc.text("Qty", 330, y);
  doc.text("Unit Price", 390, y);
  doc.text("Amount", 480, y);
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).stroke();
  y += 8;

  doc.font("Helvetica").fontSize(9);
  for (const item of data.lineItems) {
    // Start a new page before running off the bottom, so multi-page extraction
    // gets exercised by simply asking for more line items.
    if (y > 700) {
      doc.addPage();
      y = 60;
    }
    doc.text(item.description, left, y, { width: 260, ellipsis: true });
    doc.text(String(item.quantity), 330, y);
    doc.text(formatMoney(item.unitPrice), 390, y);
    doc.text(formatMoney(item.amount), 480, y);
    y += 16;
  }

  y += 6;
  doc.moveTo(330, y).lineTo(right, y).stroke();
  y += 10;

  doc.font("Helvetica").fontSize(9);
  doc.text("Subtotal", 390, y);
  doc.text(formatMoney(data.subtotal), 480, y);
  y += 14;
  doc.text(`VAT ${(data.taxRate * 100).toFixed(0)}%`, 390, y);
  doc.text(formatMoney(data.tax), 480, y);
  y += 16;
  doc.font("Helvetica-Bold").fontSize(11);
  // Currency goes in the LABEL, not beside the number: at 11pt bold, "EUR 8,735.97"
  // overflows the amount column and pdfkit wraps it, which would split the total
  // across two lines and make it needlessly hard to parse.
  doc.text(`TOTAL (${data.currency})`, 370, y);
  doc.text(formatMoney(data.total), 480, y);
}

/** Render a PDF and collect it, without touching the filesystem. */
function toBytes(build: (doc: PDFKit.PDFDocument) => void): Promise<{ bytes: Uint8Array; pageCount: number }> {
  return new Promise((resolve, reject) => {
    // `compress: false` keeps the text layer inspectable and the output stable.
    const doc = new PDFDocument({ size: "A4", margin: 50, compress: false });
    const chunks: Buffer[] = [];
    let pageCount = 0;

    doc.on("pageAdded", () => {
      pageCount += 1;
    });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve({ bytes: new Uint8Array(Buffer.concat(chunks)), pageCount }));

    // The first page exists before any listener could see it.
    pageCount = 1;
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * A synthetic invoice PDF and its ground truth.
 *
 * With `textless: true` the page carries only vector marks — the stand-in for a
 * scan, and the fixture that proves a text-layer loader reports `form: "scanned"`
 * instead of returning nonsense.
 */
export async function makeInvoicePdf(
  options: InvoiceOptions = {},
): Promise<SyntheticDocument<SyntheticInvoice>> {
  const expected = buildInvoiceData(options);

  const { bytes, pageCount } = await toBytes((doc) => {
    if (options.textless === true) {
      doc.rect(80, 80, 260, 120).fill("#d9d9d9");
      doc.rect(80, 240, 420, 3).fill("#9a9a9a");
      doc.rect(80, 280, 380, 3).fill("#9a9a9a");
      return;
    }
    renderInvoice(doc, expected);
  });

  return { bytes, expected, pageCount };
}
