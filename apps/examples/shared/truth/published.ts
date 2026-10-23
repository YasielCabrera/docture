/**
 * invoice2data's published ground truth, mapped onto our narrow scoring contract.
 *
 * Every sample in invoice2data's corpus ships a `.json` beside it. That is what turns
 * example 12 from a demo into an eval — eleven real invoices with truth somebody else
 * wrote, which is the only kind that cannot be quietly bent to match the extractor.
 *
 * THREE THINGS ABOUT IT ARE WORTH KNOWING, and each one is a way an eval harness lies.
 *
 * 1. It is a DIFFERENT SCHEMA. `issuer`, `amount`, `lines[].price_unit`, dates as
 *    `YYYY-MM-DD`. Ours is `vendor`, `total`, `lineItems[].description`.
 *
 * 2. It is NARROWER than ours, and `scoreExtraction` counts a field the extraction
 *    produced and the truth omits as a HALLUCINATION. Mapping it onto the full `Invoice`
 *    contract would invent eight fake hallucinations per document and report an F1 that
 *    means nothing. So the target is `ScoredInvoice`, and `projectOntoTruth` drops any
 *    field this particular document's truth does not claim. Grade what the truth asserts.
 *
 * 3. ITS LINE ITEMS ARE NOT COMPARABLE TO OURS, so this mapper does not score them.
 *    That is a deliberate omission and it was measured, not assumed:
 *
 *      - the container is `lines` in six samples and `line_items` in two
 *      - the description key is `name`, or `desc`, or `item`, by template
 *      - four samples publish no line items at all
 *      - the Odoo sample's only `lines` entry is `{ sectionheader: "Non Food" }` — a
 *        heading, not an item
 *      - and on the services invoice, `item` is `"A"` where our `description` is
 *        `"Service A"`, while `desc` is `"Parts: 1 x cap_a"` — which corresponds to our
 *        `notes`, not our `description`, on a different field entirely
 *
 *    Two answer keys that disagree about what a line item's description IS cannot grade
 *    each other's line items. Scoring them anyway would produce mismatches that say
 *    nothing about whether the extraction was right. So: the five scalar fields are
 *    scored here, and LINE ITEMS ARE SCORED against the hand-transcribed, complete truth
 *    in `azure-interior.ts` instead — where the shapes do agree, because a human checked
 *    them against the page.
 *
 * None of that makes it useless. It makes it real, which is the difference between an
 * eval and a self-congratulation. "Published" does not mean "correct": invoice2data's
 * Odoo template also reports `taxPercent: 0.0` on a line whose tax column is blank on
 * the page, which is its regex defaulting rather than the document.
 */

import { readFile } from "node:fs/promises";
import type { ScoredInvoiceData } from "../contracts.js";

/**
 * The union of shapes actually present in the corpus. Every field optional, because
 * every field genuinely is.
 */
interface Invoice2DataTruth {
  readonly issuer?: string;
  readonly amount?: number | string;
  readonly date?: string;
  readonly invoice_number?: string | number;
  readonly currency?: string;
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** invoice2data writes `YYYY-MM-DD`, but not always zero-padded. */
function asIsoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (match === null) return undefined;
  const [, year, month, day] = match;
  return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
}

/**
 * The published truth for one document, as a PARTIAL `ScoredInvoice`.
 *
 * Partial on purpose: a sample whose truth omits `currency` should score four fields out
 * of four, not five out of five with one wrong. Absent means "not claimed".
 */
export type PublishedTruth = Partial<ScoredInvoiceData>;

export function mapPublishedTruth(raw: unknown): PublishedTruth {
  // The files are arrays of one entry. A couple are the bare object.
  const entry = (Array.isArray(raw) ? raw[0] : raw) as Invoice2DataTruth | undefined;
  if (entry === undefined) return {};

  const total = asNumber(entry.amount);
  const invoiceDate = asIsoDate(entry.date);
  const invoiceNumber = entry.invoice_number;

  return {
    ...(invoiceNumber === undefined ? {} : { invoiceNumber: String(invoiceNumber) }),
    ...(invoiceDate === undefined ? {} : { invoiceDate }),
    ...(entry.issuer === undefined ? {} : { vendor: entry.issuer }),
    ...(entry.currency === undefined ? {} : { currency: entry.currency }),
    ...(total === undefined ? {} : { total }),
  };
}

/** Read and map the truth file that `pnpm run fetch` downloaded beside a document. */
export async function readPublishedTruth(path: string): Promise<PublishedTruth> {
  return mapPublishedTruth(JSON.parse(await readFile(path, "utf8")));
}

/**
 * Project an extraction onto exactly the fields a given truth claims.
 *
 * Without this, a document whose truth omits `currency` scores the extraction's
 * `currency` as a hallucination — punishing the extractor for being MORE complete than
 * the answer key.
 */
export function projectOntoTruth(
  extracted: ScoredInvoiceData,
  truth: PublishedTruth,
): PublishedTruth {
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(truth)) {
    projected[key] = extracted[key as keyof ScoredInvoiceData];
  }
  return projected as PublishedTruth;
}

/** Which fields this document's truth is willing to grade. For the report. */
export function claimedFields(truth: PublishedTruth): string[] {
  return Object.keys(truth);
}
