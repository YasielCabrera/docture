/**
 * The examples, asserted.
 *
 * What these check is the ARITHMETIC AND THE ROUTING, not the printing. A parser that
 * drops a line item or puts an amount in the wrong column still prints a table that looks
 * fine, and these are the assertions that would notice.
 *
 * They import contracts, parsers, classifiers and splitters FROM THE EXAMPLE FILES, so
 * they check the code you read rather than a copy of it. Each example guards its `main`
 * with `isMain`, so importing one does not run it.
 *
 * The ones that need a downloaded document SKIP when `documents/` is empty, so a fresh
 * clone with no network still passes. That is the price of real documents. The tests on
 * literal input always run — and `14-testing-your-pipeline/pipeline.test.ts` needs nothing
 * at all, which is the point of that example.
 */

import { describe, expect, it } from "vitest";
import { Extractor, SplittingStrategy, loadDocument, silentLogger } from "docture";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { scoreExtraction, formatFailures } from "@docture/eval";
import { readFile } from "node:fs/promises";

import { CheckingStatement, Invoice, ScoredInvoice, toScored } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import {
  CENT,
  checkingStatementParser,
  parseTransactions,
} from "../shared/parsers/statement.js";
import { AZURE_INTERIOR } from "../shared/truth/azure-interior.js";
import {
  mapPublishedTruth,
  projectOntoTruth,
  readPublishedTruth,
} from "../shared/truth/published.js";
import { documentsPresent, idsOfKind, pathOf, present, truthPathOf } from "../shared/documents.js";
import { pageRange } from "../shared/print.js";

// Imported from the examples themselves.
import { invoiceChain } from "../06-fallback-routing-and-errors/index.js";
import { headingClassifier } from "../10-classification/index.js";
import { ACCOUNT_KINDS, accountSplitter, bundleProcess } from "../11-bundles-and-splitting/index.js";

/**
 * Checked at module load, not in `beforeAll`: `it.runIf` is evaluated while Vitest is
 * COLLECTING, so an answer that arrives later marks everything skipped regardless.
 */
const all = documentsPresent();
if (!all) {
  console.warn("documents/ is incomplete. Run `pnpm fetch` to enable the document tests.");
}
const invoices = present("invoice-odoo", "invoice-services");
const statement = present("statement");

function invoiceExtractor(): Extractor {
  return new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser(), servicesInvoiceParser());
}

// ── The Odoo invoice ────────────────────────────────────────────────────────────

describe("the Odoo invoice", () => {
  it.runIf(invoices)("extracts all four line items, in order", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    expect(data.lineItems.map((i) => i.code)).toEqual([
      "17589684",
      "FURN_7777",
      "987123",
      "LUX_TRF",
    ]);
    expect(data.lineItems.map((i) => i.section)).toEqual([
      "Non Food",
      "Non Food",
      "Food Products",
      "Food Products",
    ]);
  });

  it.runIf(invoices)("line items sum to the stated subtotal", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    const summed = data.lineItems.reduce((total, item) => total + item.amount, 0);
    expect(summed).toBeCloseTo(data.subtotal, 2);
    expect(data.subtotal + data.tax).toBeCloseTo(data.total, 2);
  });

  /**
   * The truffles line has no tax column, and the invoice's own tax line proves it:
   * "Tax 15% on $ 112.90" is the other three lines, not all four. This is example 02's
   * whole lesson, asserted.
   */
  it.runIf(invoices)("reports an absent tax column as null, not zero", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    expect(data.lineItems[3]?.taxPercent).toBeNull();

    const taxable = data.lineItems
      .filter((item) => item.taxPercent !== null)
      .reduce((sum, item) => sum + item.amount, 0);
    expect(taxable).toBeCloseTo(112.9, 2);
  });

  it.runIf(invoices)("attaches a continuation line to the row above it", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    // Two rows carry a continuation line, and each attaches to the row DIRECTLY above it.
    expect(data.lineItems[0]?.notes).toBe("Acme beeswax");
    expect(data.lineItems[2]?.notes).toContain("re-usable glass container");
    expect(data.lineItems[1]?.notes).toBeNull();

    /**
     * The invariant that matters, and the reason the parser tracks an `openItem` flag:
     * the payment instructions further down the page must NOT be adopted as a note on the
     * last line item. Without that flag they are, and nothing looks wrong.
     */
    expect(data.lineItems[3]?.notes).toBeNull();
  });

  it.runIf(invoices)("scores F1 1.0 against complete hand-checked truth", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    const score = scoreExtraction(AZURE_INTERIOR, data);
    expect(score.f1, formatFailures(score)).toBe(1);
    expect(score.exactMatch, formatFailures(score)).toBe(true);
  });

  it.runIf(invoices)("costs nothing — no model was called", async () => {
    const extractor = invoiceExtractor();
    const result = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    expect(result.usage.totalTokens).toBe(0);
    // Absent, not zero: a zero would be indistinguishable from "it was free".
    expect(result.usage.costUsd).toBeUndefined();
  });
});

// ── The services invoice, and the fallback ──────────────────────────────────────

describe("the services invoice", () => {
  it.runIf(invoices)("is answered by the second parser, after the first fails", async () => {
    const extractor = invoiceExtractor();
    const result = await extractor.extract(pathOf("invoice-services"), Invoice);
    await extractor.dispose();

    expect(result.method).toBe("services-invoice-parser");
    // The fallback is recorded, with its reason. This is example 06's lesson.
    expect(result.attempts.map((a) => [a.strategy, a.status])).toEqual([
      ["odoo-invoice-parser", "failed"],
      ["services-invoice-parser", "ok"],
    ]);
    expect(result.attempts[0]?.error).toContain("no Odoo item table header found");
  });

  it.runIf(invoices)("puts labelled detail lines in notes, and tax in taxPercent", async () => {
    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-services"), Invoice);
    await extractor.dispose();

    expect(data.lineItems).toHaveLength(2);
    expect(data.lineItems[0]?.notes).toContain("Parts:");
    // `Tax:` on an item row is a per-item percentage, unlike the `Tax (0%):` line that
    // closes the invoice.
    expect(data.lineItems[0]?.taxPercent).not.toBeNull();
  });
});

// ── Routing across the corpus — example 06 ──────────────────────────────────────

describe("the fallback chain over the whole corpus", () => {
  it.runIf(all)("routes each document to the strategy that should answer it", async () => {
    const extractor = invoiceChain();
    const answered = new Map<string, string | null>();

    for (const id of idsOfKind("invoice")) {
      const outcome = await extractor.safeExtract(pathOf(id), Invoice);
      answered.set(id, outcome.ok ? outcome.result.method : null);
    }
    await extractor.dispose();

    // Exactly two layouts have a parser. The rest MUST fall through rather than being
    // answered wrongly — a parser that matched everything would be the bug here.
    expect(answered.get("invoice-odoo")).toBe("odoo-invoice-parser");
    expect(answered.get("invoice-services")).toBe("services-invoice-parser");

    const fellThrough = [...answered.entries()].filter(([, method]) => method === null);
    expect(fellThrough).toHaveLength(answered.size - 2);
  });

  it.runIf(invoices)("`only` pins the run to one strategy", async () => {
    const extractor = invoiceChain();
    const wrong = await extractor.safeExtract(pathOf("invoice-services"), Invoice, {
      only: ["odoo-invoice-parser"],
    });
    const right = await extractor.safeExtract(pathOf("invoice-services"), Invoice, {
      only: ["services-invoice-parser"],
    });
    await extractor.dispose();

    expect(wrong.ok).toBe(false);
    expect(right.ok).toBe(true);
  });
});

// ── The statement ───────────────────────────────────────────────────────────────

describe("the bank statement", () => {
  it.runIf(statement)("extracts all 48 transactions and reconciles", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadStrategy(checkingStatementParser());
    const { data } = await extractor.extract(pathOf("statement"), CheckingStatement, {
      pages: [1, 2, 3],
    });
    await extractor.dispose();

    expect(data.transactions).toHaveLength(48);

    const debits = data.transactions.reduce((sum, t) => sum + (t.debit ?? 0), 0);
    const credits = data.transactions.reduce((sum, t) => sum + (t.credit ?? 0), 0);

    /**
     * The check that makes the extraction trustworthy rather than plausible: opening +
     * credits - debits must land on the closing balance. A dropped row, or an amount in
     * the wrong column, breaks this. A printed table looks fine either way.
     */
    expect(data.openingBalance + credits - debits).toBeCloseTo(data.closingBalance, 2);
  });

  it.runIf(statement)("never puts a debit and a credit on the same row", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadStrategy(checkingStatementParser());
    const { data } = await extractor.extract(pathOf("statement"), CheckingStatement, {
      pages: [1, 2, 3],
    });
    await extractor.dispose();

    for (const t of data.transactions) {
      expect(t.debit === null || t.credit === null).toBe(true);
    }
  });
});

/** Always runs: literal input, no document needed. */
describe("parseTransactions, on literal input", () => {
  it("decides debit vs credit from the direction the balance moved", () => {
    const rows = parseTransactions([
      "TRANSACTIONS",
      "07/01/2019 Previous Balance $1,000.00",
      "07/01/2019 Deposit $209.54 $1,209.54",
      "07/02/2019 ACH DEBIT $21.70 $1,187.84",
      "DAILY BALANCE SUMMARY",
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]?.credit).toBeCloseTo(209.54, 2);
    expect(rows[1]?.debit).toBeNull();
    expect(rows[2]?.debit).toBeCloseTo(21.7, 2);
    expect(rows[2]?.credit).toBeNull();
  });

  it("continues a description onto the row above when a line has no date", () => {
    const rows = parseTransactions([
      "TRANSACTIONS",
      "07/01/2019 Previous Balance $1,000.00",
      "07/02/2019 C&J CLARK RETAIL $21.70 $978.30",
      "NBR 131",
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]?.description).toBe("C&J CLARK RETAIL NBR 131");
  });

  it("stops at the section boundary rather than eating the summary", () => {
    const rows = parseTransactions([
      "TRANSACTIONS",
      "07/01/2019 Previous Balance $1,000.00",
      "DAILY BALANCE SUMMARY",
      "07/03/2019 Not a transaction $1.00 $2.00",
    ]);

    expect(rows).toHaveLength(1);
  });

  it("throws rather than returning nothing when there is no table", () => {
    expect(() => parseTransactions(["nothing here"])).toThrow(/no TRANSACTIONS table/);
  });
});

// ── The bundle — example 11 ─────────────────────────────────────────────────────

describe("the bundle", () => {
  it.runIf(statement)("cuts six pages into two documents and one orphan", async () => {
    const process = bundleProcess();
    const documents = await process
      .loadFile(pathOf("statement"))
      .split(ACCOUNT_KINDS, SplittingStrategy.LAZY)
      .extract({ onUnclassified: "skip" });
    const split = process.lastSplit;
    await process.dispose();

    expect(split?.groups.map((g) => [pageRange(g.pages), g.classification])).toEqual([
      ["1 to 3", "checking-account"],
      ["4 to 5", "credit-line"],
      // Page 6 is a blank reconciliation form belonging to neither.
      ["6", "UNKNOWN"],
    ]);

    expect(documents).toHaveLength(2);
    expect(documents.map((d) => d.name)).toEqual(["checking-account", "credit-line"]);
    // The splitter reads headings, so deciding the cut cost nothing.
    expect(split?.usage.totalTokens).toBe(0);
  });

  it.runIf(statement)("throws by default rather than dropping the orphan page", async () => {
    const process = bundleProcess();
    await expect(
      process.loadFile(pathOf("statement")).split(ACCOUNT_KINDS, SplittingStrategy.LAZY).extract(),
    ).rejects.toThrow(/UNKNOWN/);
    await process.dispose();
  });

  it.runIf(statement)("narrows `data` per document", async () => {
    const process = bundleProcess();
    const documents = await process
      .loadFile(pathOf("statement"))
      .split(ACCOUNT_KINDS, SplittingStrategy.LAZY)
      .extract({ onUnclassified: "skip" });
    await process.dispose();

    for (const document of documents) {
      if (document.name === "checking-account") {
        expect(document.data.transactionRows).toBeGreaterThan(40);
        expect(document.pages).toEqual([1, 2, 3]);
      } else {
        expect(document.data.creditLimit).toBeGreaterThan(0);
        expect(document.data.availableCredit).toBeLessThan(document.data.creditLimit);
        expect(document.pages).toEqual([4, 5]);
      }
    }
  });

  it.runIf(statement)("the splitter answers seam by seam", async () => {
    const read = await loadDocument(
      [new DocumentLoaderPdfJs()],
      { bytes: new Uint8Array(await readFile(pathOf("statement"))), mimeType: "application/pdf" },
      silentLogger,
      AbortSignal.timeout(60_000),
      undefined,
    );
    const splitter = accountSplitter();
    const ctx = {
      classifications: [...ACCOUNT_KINDS],
      signal: AbortSignal.timeout(60_000),
      logger: silentLogger,
    };

    const pages = read.document.pages;
    // Page 3 → 4 is the checking/credit-line boundary; 1 → 2 is not a boundary at all.
    const inside = await splitter.belongsToSameDocument(pages[0]!, pages[1]!, ctx);
    const seam = await splitter.belongsToSameDocument(pages[2]!, pages[3]!, ctx);

    expect(inside.belongsToSameDocument).toBe(true);
    expect(seam.belongsToSameDocument).toBe(false);
    expect(seam.classificationPage2).toBe("credit-line");
  });
});

// ── Classification — example 10 ─────────────────────────────────────────────────

describe("the heading classifier", () => {
  it.runIf(all)("answers only within the candidates it was offered", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadClassifier(headingClassifier());

    const invoiceOnly = await extractor.classify(pathOf("statement"), [
      {
        name: "invoice",
        description: "An invoice.",
        schema: Invoice.schema,
      },
    ]);
    await extractor.dispose();

    // The statement is not an invoice, and `invoice` was the only candidate. Abstaining
    // is the right answer; naming a kind that was not on offer would not be.
    expect(["UNKNOWN", "invoice"]).toContain(invoiceOnly.name);
    expect(invoiceOnly.signals.length).toBeGreaterThan(0);
  });

  it.runIf(all)("recognises the three kinds it knows", async () => {
    const kinds = [
      { name: "invoice", description: "An invoice.", schema: Invoice.schema },
      { name: "credit-line", description: "A credit line.", schema: Invoice.schema },
    ];
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadClassifier(headingClassifier());

    expect((await extractor.classify(pathOf("invoice-odoo"), kinds)).name).toBe("invoice");
    expect((await extractor.classify(pathOf("statement"), kinds)).name).toBe("credit-line");
    await extractor.dispose();
  });
});

// ── The published-truth mapper — example 12 ─────────────────────────────────────

describe("the published-truth mapper", () => {
  /** Always runs: literal input. This is the trap example 12 is built around. */
  it("claims only the fields the truth actually publishes", () => {
    const sparse = mapPublishedTruth([{ issuer: "Acme", invoice_number: "A-1" }]);
    expect(Object.keys(sparse).sort()).toEqual(["invoiceNumber", "vendor"]);
    // NOT present. Absent means "not claimed", so scoring will not grade it.
    expect("total" in sparse).toBe(false);
    expect("currency" in sparse).toBe(false);
  });

  it("normalises what it does claim", () => {
    const mapped = mapPublishedTruth([
      { issuer: "Acme", invoice_number: 42, date: "2024-1-5", amount: "1,234.50", currency: "EUR" },
    ]);
    expect(mapped.invoiceNumber).toBe("42");
    expect(mapped.invoiceDate).toBe("2024-01-05");
    expect(mapped.total).toBeCloseTo(1234.5, 2);
  });

  it("projects an extraction down to exactly those fields", () => {
    const truth = mapPublishedTruth([{ issuer: "Acme", amount: 10 }]);
    const projected = projectOntoTruth(
      {
        invoiceNumber: "A-1",
        invoiceDate: "2024-01-01",
        vendor: "Acme",
        currency: "EUR",
        total: 10,
      },
      truth,
    );
    // The extraction had five fields. The truth claims two. Scoring two is the honest
    // number; scoring five would report three hallucinations that are not hallucinations.
    expect(Object.keys(projected).sort()).toEqual(["total", "vendor"]);
    expect(scoreExtraction(truth, projected).f1).toBe(1);
  });

  it.runIf(invoices)("scores the Odoo invoice at 1.0 once projected", async () => {
    const truthPath = truthPathOf("invoice-odoo");
    expect(truthPath).toBeDefined();
    const truth = await readPublishedTruth(truthPath!);

    const extractor = invoiceExtractor();
    const { data } = await extractor.extract(pathOf("invoice-odoo"), Invoice);
    await extractor.dispose();

    const honest = scoreExtraction(truth, projectOntoTruth(toScored(data), truth));
    expect(honest.f1, formatFailures(honest)).toBe(1);

    // And the naive version, to pin the trap in place: scoring the FULL contract against
    // a five-field answer key must report a much worse number for no real reason.
    const naive = scoreExtraction(truth, data);
    expect(naive.f1).toBeLessThan(0.5);
  });
});

// ── Shared helpers ──────────────────────────────────────────────────────────────

describe("pageRange", () => {
  it("collapses a contiguous run and leaves a gap alone", () => {
    expect(pageRange([1, 2, 3])).toBe("1 to 3");
    expect(pageRange([1, 3])).toBe("1, 3");
    expect(pageRange([4])).toBe("4");
    expect(pageRange([])).toBe("none");
  });
});

describe("the scoring contract", () => {
  it("is narrower than the extraction contract, on purpose", () => {
    const scored = Object.keys(
      (ScoredInvoice.schema as unknown as { shape: Record<string, unknown> }).shape,
    );
    const full = Object.keys(
      (Invoice.schema as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(scored.length).toBeLessThan(full.length);
    expect(CENT).toBeLessThan(0.01);
  });
});
