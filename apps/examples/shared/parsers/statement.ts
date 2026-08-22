/**
 * Deterministic parsers for the Carson Bank statement.
 *
 * Lifted from what used to be `src/02-statement.ts` and `src/03-bundle.ts`. Three
 * parsers, because the file holds three things:
 *
 *   - `checkingStatementParser` — the full checking account with all 48 transactions
 *   - `checkingSummaryParser`   — the same account, six fields, for the bundle example
 *   - `creditLineParser`        — the revolving credit line on pages 4 to 5
 */

import { defineStrategy, type ExtractionStrategy } from "docture";
import type { Transaction } from "../contracts.js";
import { capture, isoDate, lines, money, required } from "../text.js";

/** How close two amounts must be to count as the same movement. */
export const CENT = 0.005;

// ── The transaction table ───────────────────────────────────────────────────────

/**
 * The interesting bit. A row looks like this:
 *
 *     07/01/2019 Deposit = 131 $209.54 $654.82
 *     07/01/2019 C&J CLARK RETAIL ACH DEBIT SETTLEMENT STORE $21.70 $1,308.47
 *     NBR 131
 *
 * The statement has separate Debits and Credits columns, but a text layer flattens them
 * into reading order, so nothing in either row says which column the first amount came
 * from. What survives is the arithmetic: the balance went UP by 209.54 on the first row
 * and DOWN by 21.70 on the second. That is how `debit` and `credit` are decided here,
 * and it is the kind of thing a deterministic parser does better than a model, because
 * it is arithmetic rather than judgement.
 *
 * The third line has no date, so it continues the description above it.
 */
const ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})(?:\s+\$([\d,]+\.\d{2}))?$/;
const SECTION_END = /^(CHECKS|DAILY BALANCE SUMMARY|Account Reconciliation Form)$/;
/** A page footer or a column header, not a transaction. */
const NOISE = /^(Page \d+ of \d+|Date\s+Description|TRANSACTIONS)/;

/**
 * Rows out of the TRANSACTIONS table, with debit and credit resolved.
 *
 * Exported and tested directly on literal input. A parser whose interesting logic is
 * only reachable through a whole pipeline run is a parser nobody tests properly.
 */
export function parseTransactions(all: readonly string[]): Transaction[] {
  const start = all.findIndex((line) => line === "TRANSACTIONS");
  if (start === -1) throw new Error("no TRANSACTIONS table found");

  const rows: Transaction[] = [];
  let previousBalance: number | null = null;

  for (const line of all.slice(start + 1)) {
    if (SECTION_END.test(line)) break;
    if (NOISE.test(line)) continue;

    const match = ROW.exec(line);
    if (match === null) {
      // No leading date, so this continues the description above it.
      const last = rows.at(-1);
      if (last !== undefined && /^[A-Za-z0-9]/.test(line)) {
        last.description = `${last.description} ${line}`;
      }
      continue;
    }

    const date = required(isoDate(match[1]), "transaction date");
    const description = (match[2] ?? "").trim();
    const first = money(match[3]);
    const second = money(match[4]);
    if (first === null) continue;

    // One amount means the row IS a balance: the opening "Previous Balance" line.
    if (second === null) {
      rows.push({ date, description, debit: null, credit: null, balance: first });
      previousBalance = first;
      continue;
    }

    const balance = second;
    const rose = previousBalance !== null && balance > previousBalance;
    // Trust the arithmetic when it agrees, and fall back to the direction of travel
    // when it does not. A statement with a row we could not see still gets a sign.
    const agrees = previousBalance !== null && Math.abs(previousBalance + first - balance) < CENT;
    const isCredit = agrees ? true : previousBalance === null ? true : rose;

    rows.push({
      date,
      description,
      debit: isCredit ? null : first,
      credit: isCredit ? first : null,
      balance,
    });
    previousBalance = balance;
  }

  if (rows.length === 0) throw new Error("TRANSACTIONS table had no parseable rows");
  return rows;
}

export function checkingStatementParser(): ExtractionStrategy {
  return defineStrategy({
    name: "checking-statement-parser",
    requires: ["TEXT_LAYER"],
    needsClassification: "none",

    async extract(ctx) {
      const all = lines(ctx.document);
      const transactions = parseTransactions(all);

      return {
        data: {
          // Pages 2 and 3 carry "JOHN TEST Account Number: 6547" as a running header,
          // which pins the holder without matching every all-caps heading on page 1.
          accountHolder: required(
            capture(all, /^([A-Z][A-Z ]+?)\s+Account Number:/),
            "accountHolder",
          ),
          accountType: required(capture(all, /^(TRUE CHECKING)$/), "accountType"),
          accountNumber: required(capture(all, /Account Number:\s*(\d+)/), "accountNumber"),
          // NOT the "Statement Date:" line, whose year is redacted to "20XX" on this
          // sample. The ending-balance row carries a real date.
          statementDate: required(
            isoDate(capture(all, /Ending balance (\d{2}\/\d{2}\/\d{4})/)),
            "statementDate",
          ),
          openingBalance: required(transactions[0]?.balance, "openingBalance"),
          closingBalance: required(transactions.at(-1)?.balance, "closingBalance"),
          transactions,
        },
      };
    },
  });
}

// ── The same account, summarised — for the bundle example ───────────────────────

const TX_ROW = /^\d{2}\/\d{2}\/\d{4}\s+.+?\s+\$[\d,]+\.\d{2}(\s+\$[\d,]+\.\d{2})?$/;

/**
 * Rows of the TRANSACTIONS table only.
 *
 * The bound matters. The DAILY BALANCE SUMMARY further down packs three date/amount
 * pairs onto a line, and those match `TX_ROW` too, which counts 55 rows instead of 47.
 */
export function transactionRows(all: readonly string[]): string[] {
  const start = all.indexOf("TRANSACTIONS");
  if (start === -1) return [];
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => /^(CHECKS|DAILY BALANCE SUMMARY)$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => TX_ROW.test(line));
}

export function checkingSummaryParser(): ExtractionStrategy {
  return defineStrategy({
    name: "checking-summary-parser",
    requires: ["TEXT_LAYER"],
    async extract(ctx) {
      const all = lines(ctx.document);
      if (!all.some((line) => /TRUE CHECKING/.test(line))) {
        throw new Error("no TRUE CHECKING account on these pages");
      }
      const rows = transactionRows(all);

      return {
        data: {
          accountHolder: required(
            capture(all, /^([A-Z][A-Z ]+?)\s+Account Number:/),
            "accountHolder",
          ),
          accountType: "TRUE CHECKING",
          accountNumber: required(capture(all, /Account Number:\s*(\d+)/), "accountNumber"),
          statementDate: required(
            isoDate(capture(all, /Ending balance (\d{2}\/\d{2}\/\d{4})/)),
            "statementDate",
          ),
          endingBalance: required(
            money(capture(all, /Ending balance \d{2}\/\d{2}\/\d{4}\s+\$([\d,]+\.\d{2})/)),
            "endingBalance",
          ),
          transactionRows: rows.length,
        },
      };
    },
  });
}

export function creditLineParser(): ExtractionStrategy {
  return defineStrategy({
    name: "credit-line-parser",
    requires: ["TEXT_LAYER"],
    async extract(ctx) {
      const all = lines(ctx.document);
      if (!all.some((line) => /READY RESERVE/.test(line))) {
        throw new Error("no READY RESERVE account on these pages");
      }

      return {
        data: {
          accountHolder: required(
            capture(all, /^([A-Z][A-Z ]+?)\s+Account Number:/),
            "accountHolder",
          ),
          accountType: "READY RESERVE",
          accountNumber: required(
            capture(all, /READY RESERVE Account Number:\s*(\d+)/),
            "accountNumber",
          ),
          statementDate: required(
            isoDate(capture(all, /Closing Date\s+(\d{2}\/\d{2}\/\d{4})/)),
            "statementDate",
          ),
          previousBalance: required(
            money(capture(all, /^Previous Balance\s+([\d,]+\.\d{2})/)),
            "previousBalance",
          ),
          newBalance: required(money(capture(all, /New Balance\s+([\d,]+\.\d{2})/)), "newBalance"),
          creditLimit: required(
            money(capture(all, /^Credit Limit\s+([\d,]+\.\d{2})$/)),
            "creditLimit",
          ),
          availableCredit: required(
            money(capture(all, /^Available Credit\s+([\d,]+\.\d{2})$/)),
            "availableCredit",
          ),
          paymentDueDate: isoDate(capture(all, /Current Payment Due Date\s+(\d{2}\/\d{2}\/\d{4})/)),
          interestChargedThisPeriod: required(
            money(capture(all, /Total Interest For This Period:\s*([\d,]+\.\d{2})/)),
            "interestChargedThisPeriod",
          ),
          annualPercentageRate: Number(
            capture(all, /\s([\d.]+)%\s+\d+\s+[\d,]+\.\d{2}\s+[\d.]+$/) ?? Number.NaN,
          ),
        },
      };
    },
  });
}
