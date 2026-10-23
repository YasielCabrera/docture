/**
 * The shape you ask for, and what the library does with it.
 *
 *     pnpm --filter @docture/examples contracts
 *
 * Needs: `pnpm run fetch`. No API key.
 *
 * Read top to bottom:
 *
 *   1. A BARE SCHEMA is enough. A CONTRACT adds a name and prose for a model
 *   2. `null` IS NOT ABSENT — the Odoo invoice proves it on a real row
 *   3. THE TYPE IS INFERRED, to its leaves, with no cast anywhere
 *   4. ANY SCHEMA LIBRARY, including raw JSON Schema
 *   5. `resolveSchema` — the three faces of a contract a strategy actually uses
 *   6. A VIOLATION IS TYPED, and says which field and why
 */

import { ContractViolationError, Extractor, contract, contractName, isContract, resolveSchema, schemaOf, type InferContract } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";
import { Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { amount, field, heading, note, step, table } from "../shared/print.js";
import { isMain, requireDocument, run } from "../shared/run.js";

// ── 1. A bare schema, and a contract ────────────────────────────────────────────

/**
 * Everything that takes a contract also takes a bare schema. This is a complete,
 * valid thing to hand `extract`.
 */
const BareInvoice = z.object({
  invoiceNumber: z.string(),
  total: z.number(),
});

/**
 * A contract is that schema plus the three things only a HUMAN OR A MODEL reads:
 *
 *   - `name`        the discriminant. Shows up in classification and in the CLI.
 *   - `description` what this kind of document is. Goes into the prompt.
 *   - `hints`       layout quirks and gotchas. Also the prompt, but per-kind.
 *
 * None of it changes the output type. `InferContract<typeof NamedInvoice>` is the same
 * type as `z.infer<typeof BareInvoice>`. The name is only worth writing when something
 * reads it — which is why `contract()` is a choice and not a requirement.
 */
const NamedInvoice = contract({
  name: "tiny-invoice",
  description: "A commercial invoice, reduced to the two fields anyone actually pays.",
  hints: "Amounts may use a comma as a thousands separator.",
  schema: BareInvoice,
});

async function main(): Promise<void> {
  const path = await requireDocument("invoice-odoo");

  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser());

  try {
    heading("Contracts and schemas");

    step("1. a bare schema is enough; a contract adds a name and prose");

    field("isContract(BareInvoice)", isContract(BareInvoice));
    field("isContract(NamedInvoice)", isContract(NamedInvoice));
    field("contractName(NamedInvoice)", contractName(NamedInvoice) ?? "(none)");
    field("contractName(BareInvoice)", contractName(BareInvoice) ?? "(none)");
    // `schemaOf` unwraps either one to the underlying schema, which is what a strategy
    // or a model client wants. Both of these are the same object.
    field("schemaOf unwraps to the same", schemaOf(NamedInvoice) === BareInvoice);

    // ── 2. `null` is not absent ───────────────────────────────────────────────────

    step("2. `null` is not absent");

    const invoice = await extractor.extractData(path, Invoice);

    note(
      "The Odoo invoice has four line items. Three carry a tax percentage; the fourth's\n" +
        "tax column is BLANK ON THE PAGE. Those are different facts, so they get\n" +
        "different values — `taxPercent` is `.nullable()`, not defaulted to 0.",
    );
    console.log("");
    table(
      [
        { header: "description", width: 22 },
        { header: "taxPercent", width: 12, right: true },
        { header: "what that means", width: 34 },
      ],
      invoice.lineItems.map((item) => [
        item.description,
        item.taxPercent === null ? "null" : amount(item.taxPercent),
        item.taxPercent === null ? "no tax column on this row" : "taxed at this rate",
      ]),
    );

    /**
     * And the document agrees, which is the part worth checking rather than asserting.
     *
     * The invoice's own tax line reads "Tax 15% on $ 112.90". The three taxed lines
     * come to 112.90; the truffles line sat outside the taxable base. So `null` is what
     * the page says, and invoice2data's published truth reporting `0.0` here is its
     * regex defaulting rather than the document.
     */
    const taxable = invoice.lineItems
      .filter((item) => item.taxPercent !== null)
      .reduce((sum, item) => sum + item.amount, 0);
    console.log("");
    field("taxed lines sum to", amount(taxable));
    field("invoice says taxed on", "112.90");
    field("so `null` is the document", Math.abs(taxable - 112.9) < 0.005 ? "confirmed" : "NO");

    // ── 3. The type is inferred, to its leaves ────────────────────────────────────

    step("3. the type is inferred, to its leaves");

    /** `InferContract` is the library's own helper: the data type a contract produces. */
    type LineItem = InferContract<typeof Invoice>["lineItems"][number];

    // Every one of these is checked at compile time. Rename a field in
    // shared/contracts.ts and this block stops compiling — which is the whole point.
    const first: LineItem | undefined = invoice.lineItems[0];
    const unit: string | null = first?.unit ?? null;
    const quantity: number = first?.quantity ?? 0;

    field("lineItems[0].unit", `${JSON.stringify(unit)}  (string | null)`);
    field("lineItems[0].quantity", `${quantity}  (number)`);
    note(
      "No cast, no generic parameter, no `as`. The library takes the AI SDK's own\n" +
        "`FlexibleSchema` / `InferSchema` as its contract type rather than inventing one,\n" +
        "so the inference is the SDK's and composes exactly with `generateObject`.",
    );

    // ── 4. Any schema library, including raw JSON Schema ─────────────────────────

    step("4. the same extraction, driven by raw JSON Schema");

    /**
     * No Zod here. `jsonSchema()` from the AI SDK wraps a plain JSON Schema object and
     * carries the output type as a type argument, because a JSON Schema has no types to
     * infer from — you say what it produces.
     *
     * Valibot and ArkType work the same way, unchanged, for the same reason: the
     * contract type is the SDK's `FlexibleSchema`, so anything it accepts, this accepts.
     */
    const { jsonSchema } = await import("ai");
    const JsonInvoice = jsonSchema<{ invoiceNumber: string; total: number }>({
      type: "object",
      properties: {
        invoiceNumber: { type: "string" },
        total: { type: "number" },
      },
      required: ["invoiceNumber", "total"],
      additionalProperties: true,
    });

    const viaJsonSchema = await extractor.extractData(path, JsonInvoice);
    field("invoiceNumber", viaJsonSchema.invoiceNumber);
    field("total", amount(viaJsonSchema.total));
    field("typed as", "{ invoiceNumber: string; total: number }");

    // ── 5. resolveSchema — the three faces of a contract ─────────────────────────

    step("5. resolveSchema — what a strategy is actually handed");

    /**
     * A strategy never sees your Zod object. It gets this, settled once per run:
     *
     *   - `flexible`   the original, to hand a model unchanged
     *   - `jsonSchema` the JSON Schema, for a prompt or a doc page
     *   - `validate`   one definition of "valid", shared by parsers and models
     */
    const resolved = await resolveSchema(schemaOf(NamedInvoice));
    const properties = Object.keys(
      (resolved.jsonSchema["properties"] ?? {}) as Record<string, unknown>,
    );
    field("jsonSchema.type", String(resolved.jsonSchema["type"]));
    field("jsonSchema.properties", properties.join(", "));

    const good = await resolved.validate({ invoiceNumber: "INV-1", total: 10 });
    const bad = await resolved.validate({ invoiceNumber: "INV-1", total: "ten" });
    field("validate(good).ok", good.ok);
    field("validate(bad).ok", bad.ok);
    if (!bad.ok) {
      for (const issue of bad.issues) {
        field(`  issue at "${issue.path}"`, issue.message);
      }
    }

    // ── 6. A violation is typed ──────────────────────────────────────────────────

    step("6. a contract violation is typed, and says which field");

    /**
     * The Odoo parser produces an invoice. Ask it for a schema the invoice cannot
     * satisfy and the pipeline — not the parser — turns that into a
     * `ContractViolationError` carrying the issues.
     *
     * That split matters: a strategy does not validate, so `validation` cannot come to
     * mean two different things depending on which strategy answered.
     */
    const Impossible = z.object({
      invoiceNumber: z.string(),
      shippingWeightKg: z.number(),
    });

    const outcome = await extractor.safeExtract(path, Impossible);
    if (!outcome.ok && outcome.error instanceof ContractViolationError) {
      field("error class", outcome.error.constructor.name);
      // A literal `code`, so a `switch` over it is exhaustive. Example 06 does that.
      field("error.code", outcome.error.code);
      for (const issue of outcome.error.issues) {
        field(`issue at "${issue.path}"`, issue.message);
      }
    } else {
      field("unexpected", "the impossible schema was satisfied");
    }

    console.log("\n  Next: 03-loaders-and-sources — where the bytes come from.");
  } finally {
    await extractor.dispose();
  }
}

if (isMain(import.meta.url)) await run(main);
