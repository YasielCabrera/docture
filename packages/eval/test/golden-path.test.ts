/**
 * The golden path: a real PDF, a real loader, a real schema, scored.
 *
 * Deterministic, offline, no API key, no confidential document — so it runs in CI
 * on every commit and still exercises loader → pipeline → schema → scorer end to
 * end. The strategy below is hand-written on purpose: it doubles as the worked
 * example of the "bring your own strategy" extension point, and it proves the
 * deterministic path needs no model at all.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExtractor,
  defineStrategy,
  type ExtractionStrategy,
  type LoadedDocument,
} from "@docture/core";
import { PdfJsLoader } from "@docture/loader-pdfjs";
import { makeInvoicePdf } from "@docture/testing";
import { formatFailures, formatScoreboard, recordRun, scoreExtraction } from "../src/index.js";

const Invoice = z.object({
  invoiceNumber: z.string(),
  issuedAt: z.string(),
  dueAt: z.string(),
  currency: z.string(),
  sellerName: z.string(),
  buyerName: z.string(),
  subtotal: z.number(),
  taxRate: z.number(),
  tax: z.number(),
  total: z.number(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    }),
  ),
});

/** `"1,234.56"` → `1234.56`. */
function parseMoney(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function allLines(document: LoadedDocument): string[] {
  return document.pages.flatMap((page) => (page.lines ?? []).map((line) => line.text));
}

function after(lines: readonly string[], label: string): string | undefined {
  const line = lines.find((l) => l.startsWith(label));
  return line?.slice(label.length).trim();
}

/**
 * A deterministic invoice parser over the loader's positioned lines.
 *
 * This is what a real project writes instead of paying a model per document: the
 * layout is known, so reading it is a parsing problem. Note it throws rather than
 * returning a half-filled object — a strategy that cannot do the job must let the
 * next one try (`ExtractionStrategy.extract`).
 */
const invoiceParser: ExtractionStrategy = defineStrategy({
  name: "invoice-parser",
  requires: ["TEXT_LAYER", "GEOMETRY"],

  async extract(ctx) {
    const lines = allLines(ctx.document);

    const invoiceNumber = after(lines, "Invoice Number:");
    if (invoiceNumber === undefined) {
      throw new Error("no 'Invoice Number:' line — this is not an invoice we can read");
    }

    // The two parties sit side by side, so they share a line: "From: To:" then
    // "<seller> <buyer>". The seller/buyer split is the line after the labels.
    const partiesIndex = lines.findIndex((l) => l.startsWith("From:"));
    const parties = lines[partiesIndex + 1] ?? "";

    const totalsRow = (label: string): number | undefined => {
      const line = lines.find((l) => l.startsWith(label));
      const amount = line?.match(/([\d,]+\.\d{2})\s*$/)?.[1];
      return amount === undefined ? undefined : parseMoney(amount);
    };

    // A line item row is: description … qty unitPrice amount
    const rowPattern = /^(.*?#\d+)\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/;
    const lineItems = lines
      .map((line) => rowPattern.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({
        description: match[1]!.trim(),
        quantity: Number(match[2]),
        unitPrice: parseMoney(match[3]!),
        amount: parseMoney(match[4]!),
      }));

    const currency = lines.find((l) => l.startsWith("TOTAL ("))?.match(/\(([A-Z]{3})\)/)?.[1];
    // The rate is on the VAT row's label — "VAT 19%   1,394.82".
    const ratePercent = lines.find((l) => l.startsWith("VAT "))?.match(/VAT\s+(\d+(?:\.\d+)?)%/)?.[1];

    return {
      data: {
        invoiceNumber,
        issuedAt: after(lines, "Issue Date:"),
        dueAt: after(lines, "Due Date:"),
        currency,
        // The seller ends where the buyer begins; both come from a known pool, so
        // splitting on the buyer's first word is enough for the fixture.
        sellerName: parties.split(/\s{2,}|\s(?=[A-Z][a-z]+\s(?:Manufacturing|Logistics|Works))/)[0]?.trim(),
        buyerName: parties.match(/(?:Arclight Manufacturing SA|Trellis Logistics AG|Pinnacle Works Oy)$/)?.[0],
        subtotal: totalsRow("Subtotal"),
        taxRate: ratePercent === undefined ? undefined : Number(ratePercent) / 100,
        tax: totalsRow("VAT"),
        total: totalsRow("TOTAL ("),
        lineItems,
      },
    };
  },
});

describe("golden path — PDF in, typed data out, scored", () => {
  const extractor = createExtractor({
    loaders: [new PdfJsLoader()],
    strategies: [invoiceParser],
  });

  it("extracts a single-page invoice with F1 1.0 and an exact match", async () => {
    const pdf = await makeInvoicePdf({ seed: 301, lineItemCount: 5 });

    const result = await extractor.extract(pdf.bytes, Invoice);
    const score = scoreExtraction(pdf.expected, result.data);

    expect(score.f1, formatFailures(score)).toBe(1);
    expect(score.exactMatch, formatFailures(score)).toBe(true);
    expect(result.method).toBe("invoice-parser");
    expect(result.loader).toBe("pdfjs");
    // No model ran, so nothing was spent.
    expect(result.usage.totalTokens).toBe(0);
    expect(result.usage.costUsd).toBeUndefined();
  });

  it("holds up across several seeds", async () => {
    const records = [];
    for (const seed of [302, 303, 304, 305, 306]) {
      const pdf = await makeInvoicePdf({ seed, lineItemCount: 6 });
      const result = await extractor.extract(pdf.bytes, Invoice);
      const score = scoreExtraction(pdf.expected, result.data);
      records.push(recordRun(`invoice-${seed}`, score, result));
    }

    const board = formatScoreboard(records);
    for (const record of records) {
      expect(record.score.f1, `${record.document}\n${formatFailures(record.score)}\n${board}`).toBe(1);
    }
  });

  it("extracts a multi-page invoice, including rows on page 2", async () => {
    const pdf = await makeInvoicePdf({ seed: 307, lineItemCount: 45 });
    expect(pdf.pageCount).toBeGreaterThan(1);

    const result = await extractor.extract(pdf.bytes, Invoice);

    expect(result.data.lineItems).toHaveLength(45);
    const score = scoreExtraction(pdf.expected, result.data);
    expect(score.f1, formatFailures(score)).toBe(1);
  });

  it("does not run the parser on a scanned page, and says why", async () => {
    const pdf = await makeInvoicePdf({ seed: 308, textless: true });

    const outcome = await extractor.safeExtract(pdf.bytes, Invoice);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // A wiring diagnosis, not a mysterious parse failure: the document has no
      // text layer, so a text-layer strategy was never a candidate.
      expect(outcome.error.message).toMatch(/no extraction strategy is eligible/i);
      expect(outcome.error.message).toContain("textLayer=false");
    }
  });

  it("scores a batch through extractBatch", async () => {
    const pdfs = await Promise.all(
      [401, 402, 403].map((seed) => makeInvoicePdf({ seed, lineItemCount: 4 })),
    );

    const scored: number[] = [];
    for await (const item of extractor.extractBatch(
      pdfs.map((p) => p.bytes),
      Invoice,
      { concurrency: 2 },
    )) {
      expect(item.outcome.ok).toBe(true);
      if (item.outcome.ok) {
        const score = scoreExtraction(pdfs[item.index]!.expected, item.outcome.result.data);
        scored.push(score.f1);
      }
    }

    expect(scored).toHaveLength(3);
    expect(scored.every((f1) => f1 === 1)).toBe(true);
  });
});
