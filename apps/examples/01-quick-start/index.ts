/**
 * The whole library, in one screen.
 *
 *     pnpm --filter @docture/examples quick-start
 *
 * Needs: `pnpm run fetch`. No API key — this runs on a deterministic parser reading a real
 * text layer, so it works offline and gives the same answer twice.
 *
 * Read top to bottom:
 *
 *   1. WIRE an extractor: one loader, one strategy
 *   2. EXTRACT, three ways, because they answer different questions
 *   3. READ THE ENVELOPE: which strategy answered, and what it cost
 */

import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { amount, field, heading, provenance, step, table } from "../shared/print.js";
import { isMain, requireDocument, run } from "../shared/run.js";

async function main(): Promise<void> {
  const path = await requireDocument("invoice-odoo");

  // ── 1. Wire it ────────────────────────────────────────────────────────────────

  /**
   * Two decisions, one line each.
   *
   * `loadDocumentLoader` says how bytes become text. `loadStrategy` says how text
   * becomes data. There is no third thing: a model, if you want one, is just another
   * strategy — see example 07.
   *
   * The fluent form reads top-to-bottom. `new Extractor({ loaders, strategies })` is
   * the same object from one literal, which is what you want when the wiring comes
   * from a config file. Example 13 shows that form.
   */
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser());

  try {
    heading("A real Odoo invoice, read by a deterministic parser");

    // ── 2. Extract ──────────────────────────────────────────────────────────────

    step("extractData — when you only want the fields");

    /**
     * The one-liner. `invoice` is typed from the contract's schema, to its leaves:
     * `lineItems` is an array, its elements have a `unit` that is `string | null`, and
     * none of it needed a cast or a generic parameter.
     */
    const invoice = await extractor.extractData(path, Invoice);
    field("invoice number", invoice.invoiceNumber);
    field("vendor", invoice.vendor);
    field("total", `${invoice.currency} ${amount(invoice.total)}`);
    // Hover this in an editor: `number`, inferred from the Zod schema in
    // shared/contracts.ts. Change the schema and this line stops compiling.
    field("first line amount", amount(invoice.lineItems[0]?.amount));

    step("extract — when you want to know HOW you got them");

    /**
     * The envelope. `extract` returns the same `data`, plus everything about the run.
     *
     * This is the default for a reason: "which strategy answered and what did it
     * cost" are exactly the questions asked when a number looks wrong, and an API
     * that makes you re-run to find out is an API that gets guessed at instead.
     */
    const result = await extractor.extract(path, Invoice);

    console.log(`\n  ${result.data.lineItems.length} line items:\n`);
    table(
      [
        { header: "section", width: 14 },
        { header: "code", width: 10 },
        { header: "description", width: 22 },
        { header: "qty", width: 6, right: true },
        { header: "unit", width: 5 },
        { header: "price", width: 9, right: true },
        { header: "tax%", width: 6, right: true },
        { header: "amount", width: 10, right: true },
      ],
      result.data.lineItems.map((item) => [
        item.section ?? "",
        item.code ?? "",
        item.description,
        amount(item.quantity),
        item.unit ?? "",
        amount(item.unitPrice),
        // `null` and `0` are different answers. This row's tax column is genuinely
        // blank on the page — see example 02, which is built around that distinction.
        item.taxPercent === null ? "—" : amount(item.taxPercent),
        amount(item.amount),
      ]),
    );

    // ── 3. Read the envelope ────────────────────────────────────────────────────

    step("the envelope");

    // `provenance` is four lines of printing in shared/print.ts. What it prints is
    // `result.method`, `result.loader`, `result.usage` and any failed `result.attempts`.
    provenance(result);

    console.log("");
    field("strategies tried", result.attempts.length);
    // The pipeline validates once, against your schema, however the data was produced.
    // A deterministic parser and a model are held to the same contract.
    field("contract validated", result.validation.valid ? "yes" : "no");
    field("document form", result.features.form);
    field("pages", result.features.pageCount);

    /**
     * The check that makes an extraction trustworthy rather than merely plausible.
     *
     * A parser that quietly dropped a row still prints a table that looks fine. The
     * arithmetic is what notices.
     */
    const summed = result.data.lineItems.reduce((total, item) => total + item.amount, 0);
    field(
      "items sum to subtotal",
      Math.abs(summed - result.data.subtotal) < 0.005
        ? "yes"
        : `NO — items total ${amount(summed)}, subtotal says ${amount(result.data.subtotal)}`,
    );

    console.log(
      "\n  No model was called. `usage.totalTokens` is 0 and `usage.costUsd` is absent,\n" +
        "  which is the honest answer rather than a zero that might mean 'unpriced'.",
    );
    console.log("\n  Next: 02-contracts-and-schemas — the shape you ask for.");
  } finally {
    // Releases loader engines, WASM instances and model clients. Idempotent.
    await extractor.dispose();
  }
}

if (isMain(import.meta.url)) await run(main);
