/**
 * The contracts every example shares.
 *
 * A contract is a schema that knows its own name and how to describe itself to a
 * model. Example 02 is where all of that gets explained; this file is where the
 * results live so the other fourteen can import one and get on with their own lesson.
 */

import { contract, type InferContract } from "docture";
import { z } from "zod";

// ── Invoices ────────────────────────────────────────────────────────────────────

/**
 * One contract for every invoice layout in the corpus, which is the point.
 *
 * The Odoo invoice has product codes, sections and per-line tax; the services invoice
 * has none of those; the AWS invoice has no quantity column at all. Fields a layout
 * does not carry are `.nullable()` rather than absent, because a parser that silently
 * dropped a column and a document that genuinely has no such column must not look the
 * same.
 */
export const Invoice = contract({
  name: "invoice",
  description:
    "A commercial invoice: who issued it, who owes it, and an itemised table of what " +
    "is being charged for.",
  hints:
    "Amounts may use a comma as a thousands separator. A line item's description can " +
    "continue onto the next line; keep that continuation out of the description and " +
    "put it in `notes`.",
  schema: z.object({
    invoiceNumber: z.string(),
    invoiceDate: z.string().describe("ISO 8601 date, YYYY-MM-DD."),
    dueDate: z.string().nullable(),
    reference: z.string().nullable().describe("A customer or purchase-order reference."),
    vendor: z.string().describe("Who issued the invoice."),
    customer: z.string().nullable(),
    currency: z.string().describe("ISO 4217 code, e.g. USD."),
    lineItems: z
      .array(
        z.object({
          code: z.string().nullable(),
          description: z.string().describe("The item name, without continuation lines."),
          notes: z.string().nullable().describe("Free text under the item."),
          section: z.string().nullable().describe("The heading this item sits under."),
          quantity: z.number(),
          unit: z.string().nullable().describe("kg, Units, L, g, or null."),
          unitPrice: z.number(),
          discountPercent: z.number().nullable(),
          taxPercent: z.number().nullable(),
          amount: z.number().describe("Line total after any discount."),
        }),
      )
      .min(1),
    subtotal: z.number(),
    tax: z.number(),
    total: z.number(),
  }),
});

export type InvoiceData = InferContract<typeof Invoice>;
export type LineItem = InvoiceData["lineItems"][number];

/**
 * The narrow contract used for SCORING across the whole corpus.
 *
 * Deliberately smaller than {@link Invoice}, and the reason is subtle enough that
 * example 12 is built around it: `scoreExtraction` counts a field the extraction
 * produced and the truth omits as a HALLUCINATION. invoice2data's published truth
 * covers six fields and a list of line names. Scoring a 14-field extraction against it
 * would manufacture eight fake hallucinations per document and report an F1 that means
 * nothing.
 *
 * So: score what the truth actually claims, and say so.
 */
export const ScoredInvoice = contract({
  name: "scored-invoice",
  description: "The subset of an invoice that invoice2data publishes ground truth for.",
  schema: z.object({
    invoiceNumber: z.string(),
    invoiceDate: z.string().describe("ISO 8601 date, YYYY-MM-DD."),
    vendor: z.string(),
    currency: z.string(),
    total: z.number(),
  }),
});

export type ScoredInvoiceData = InferContract<typeof ScoredInvoice>;

/** Project a full extraction onto the narrow shape the published truth can grade. */
export function toScored(invoice: InvoiceData): ScoredInvoiceData {
  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    vendor: invoice.vendor,
    currency: invoice.currency,
    total: invoice.total,
  };
}

// ── The bank statement ──────────────────────────────────────────────────────────

export const CheckingStatement = contract({
  name: "checking-account",
  description:
    "A bank statement for a deposit or checking account: the account it covers, the " +
    "period, the opening and closing balances, and every transaction in between.",
  hints:
    "A transaction row shows one amount plus the running balance. Whether that amount " +
    "is a debit or a credit follows from whether the balance went down or up.",
  schema: z.object({
    accountHolder: z.string(),
    accountType: z.string().describe('e.g. "TRUE CHECKING".'),
    accountNumber: z.string(),
    statementDate: z.string(),
    openingBalance: z.number(),
    closingBalance: z.number(),
    transactions: z
      .array(
        z.object({
          date: z.string().describe("ISO 8601 date, YYYY-MM-DD."),
          description: z.string(),
          /** Exactly one of `debit` and `credit` is set on a real movement. */
          debit: z.number().nullable(),
          credit: z.number().nullable(),
          balance: z.number().describe("The running balance after this transaction."),
        }),
      )
      .min(1),
  }),
});

export type Transaction = InferContract<typeof CheckingStatement>["transactions"][number];

/**
 * The summary shapes used when the statement is treated as a BUNDLE rather than as one
 * document — example 11. Small on purpose: the lesson there is the split and the
 * narrowing, not re-deriving all 48 transactions, which example 08 already does.
 */
export const CheckingSummary = z.object({
  accountHolder: z.string(),
  accountType: z.string(),
  accountNumber: z.string(),
  statementDate: z.string(),
  /**
   * From the ACCOUNT ACTIVITY SUMMARY on page 1, which covers MORE movements than the
   * transaction table prints.
   */
  endingBalance: z.number(),
  /** Rows printed in the TRANSACTIONS table, which is not the whole account. */
  transactionRows: z.number(),
});

export const CreditLineSummary = z.object({
  accountHolder: z.string(),
  accountType: z.string(),
  accountNumber: z.string(),
  statementDate: z.string(),
  previousBalance: z.number(),
  newBalance: z.number(),
  creditLimit: z.number(),
  availableCredit: z.number(),
  paymentDueDate: z.string().nullable(),
  interestChargedThisPeriod: z.number(),
  annualPercentageRate: z.number().nullable(),
});
