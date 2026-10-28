/**
 * Is it right, and what did it cost?
 *
 *     pnpm --filter @docture/examples accuracy
 *
 * Needs: `pnpm run fetch`. No API key.
 *
 * Eleven real invoices, each with ground truth PUBLISHED BY SOMEBODY ELSE. That last
 * part is what makes this an eval rather than a self-congratulation: truth you wrote
 * yourself is truth you will bend, unconsciously, until the number looks good.
 *
 * Read top to bottom:
 *
 *   1. ONE DOCUMENT, SCORED, against complete hand-checked truth. F1 1.0
 *   2. THE TRAP: an incomplete answer key reports hallucinations that are not there
 *   3. WHAT WENT WRONG — `failures`, `hallucinations`, `formatFailures`
 *   4. THE THREE TOLERANCES, and why each one exists
 *   5. THE SCOREBOARD, over the whole corpus
 *   6. `extractBatch` — many documents, bounded concurrency
 */

import { Extractor } from "docture/node";
import {
  aggregate,
  failures,
  formatFailures,
  formatScoreboard,
  hallucinations,
  recordRun,
  scoreExtraction,
  type RunRecord,
} from "docture/eval";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { Invoice, toScored, type InvoiceData } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { AZURE_INTERIOR } from "../shared/truth/azure-interior.js";
import {
  claimedFields,
  projectOntoTruth,
  readPublishedTruth,
} from "../shared/truth/published.js";
import { field, heading, note, step, table } from "../shared/print.js";
import { idsOfKind, pathOf, truthPathOf } from "../shared/documents.js";
import { isMain, requireDocument, run } from "../shared/run.js";

async function main(): Promise<void> {
  const odooPath = await requireDocument("invoice-odoo");

  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(odooInvoiceParser(), servicesInvoiceParser());

  try {
    heading("Accuracy, and what it cost");

    // ── 1. One document, scored ─────────────────────────────────────────────────

    step("1. one document, against complete hand-checked truth");

    const odoo = await extractor.extractData(odooPath, Invoice);

    /**
     * `AZURE_INTERIOR` is invoice2data's published truth for this document, transcribed
     * into our schema and CHECKED AGAINST THE TEXT LAYER BY HAND — all fourteen fields
     * and all four line items. That completeness is what makes an F1 of 1.0 mean
     * something here.
     */
    const score = scoreExtraction(AZURE_INTERIOR, odoo);
    field("fields scored", score.fields.length);
    field("precision", score.precision.toFixed(3));
    field("recall", score.recall.toFixed(3));
    field("F1", score.f1.toFixed(3));
    field("exactMatch", score.exactMatch);
    field("counts", JSON.stringify(score.counts));
    if (score.f1 < 1) console.log(formatFailures(score));

    // ── 2. The trap ─────────────────────────────────────────────────────────────

    step("2. the trap that makes an eval lie to you");

    /**
     * `scoreExtraction` counts a field the extraction produced and the truth OMITS as a
     * hallucination. That is exactly right for grading a real run — a model inventing a
     * `dueDate` is a serious fault, not a bonus.
     *
     * It also means an INCOMPLETE answer key punishes an extractor for being more
     * complete than the key. invoice2data publishes five comparable fields; our contract
     * has fourteen plus a line-item table. Score one against the other naively:
     */
    const truthPath = truthPathOf("invoice-odoo");
    const published = truthPath === undefined ? {} : await readPublishedTruth(truthPath);

    const naive = scoreExtraction(published, odoo);
    const honest = scoreExtraction(published, projectOntoTruth(toScored(odoo), published));

    table(
      [
        { header: "how it was scored", width: 34 },
        { header: "F1", width: 8, right: true },
        { header: "hallucinations", width: 15, right: true },
        { header: "verdict", width: 16 },
      ],
      [
        [
          "full contract vs 5-field truth",
          naive.f1.toFixed(3),
          hallucinations(naive).length,
          "meaningless",
        ],
        [
          "projected onto what truth claims",
          honest.f1.toFixed(3),
          hallucinations(honest).length,
          "a real number",
        ],
      ],
    );

    field("what this truth claims", claimedFields(published).join(", "));
    note(
      "The first row's hallucinations are every field invoice2data simply did not publish.\n" +
        "None of them is wrong. `projectOntoTruth` drops the fields the answer key is silent\n" +
        "about, so the score grades what the truth actually asserts.\n\n" +
        "This is the single most common way a real eval harness lies, and it lies in the\n" +
        "FLATTERING direction as often as not — which is why it survives code review.",
    );

    // ── 3. What went wrong ──────────────────────────────────────────────────────

    step("3. what went wrong, field by field");

    /**
     * A real miss, not a manufactured one. Our services parser reads the letterhead as
     * "Sammy Maystone"; invoice2data's truth says "Sammy Maystone - For Lines testing".
     * Both are defensible readings of the same page, which is what makes it the right
     * example for `stringSimilarity` in section 4.
     */
    const servicesPath = pathOf("invoice-services");
    const servicesTruthPath = truthPathOf("invoice-services");
    const servicesTruth =
      servicesTruthPath === undefined ? {} : await readPublishedTruth(servicesTruthPath);
    const services = await extractor.extractData(servicesPath, Invoice);
    const servicesScore = scoreExtraction(
      servicesTruth,
      projectOntoTruth(toScored(services), servicesTruth),
    );

    field("F1", servicesScore.f1.toFixed(3));
    console.log("");
    table(
      [
        { header: "field", width: 16 },
        { header: "status", width: 12 },
        { header: "expected", width: 36 },
        { header: "got", width: 22 },
      ],
      servicesScore.fields.map((f) => [
        f.path,
        f.status,
        JSON.stringify(f.expected)?.slice(0, 35) ?? "—",
        JSON.stringify(f.actual)?.slice(0, 21) ?? "—",
      ]),
    );

    field("failures(score)", failures(servicesScore).map((f) => f.path).join(", ") || "none");
    field("hallucinations(score)", hallucinations(servicesScore).map((f) => f.path).join(", ") || "none");
    console.log(`\n  formatFailures(score):\n${formatFailures(servicesScore)}`);

    // ── 4. The three tolerances ─────────────────────────────────────────────────

    step("4. the three tolerances, and why each one exists");

    /**
     * `numericTolerance` — default 0.01, one cent.
     *
     * Not a nicety. The Odoo invoice ROUNDS ITS OWN TAX: 112.90 x 0.15 is exactly 16.935
     * and the page prints 16.94. Worse, binary floating point puts 16.935 a hair BELOW
     * the midpoint, so `Math.round` gives 16.93. An equality check on money is a bug
     * waiting for a document like this one.
     */
    const tolerant = scoreExtraction({ tax: 16.935 }, { tax: 16.94 });
    const strict = scoreExtraction({ tax: 16.935 }, { tax: 16.94 }, { numericTolerance: 0 });
    field("16.935 vs 16.94, default", tolerant.f1.toFixed(3));
    field("… with tolerance 0", strict.f1.toFixed(3));

    /**
     * `stringSimilarity` — default 0.9. Forgives an OCR character slip in a long name
     * without accepting a different name. Section 3's vendor mismatch is exactly the
     * judgement call this knob exists for.
     */
    const pair = { vendor: "Sammy Maystone - For Lines testing" };
    const got = { vendor: "Sammy Maystone" };
    console.log("");
    for (const threshold of [0.9, 0.6, 0.4] as const) {
      const s = scoreExtraction(pair, got, { stringSimilarity: threshold });
      field(`stringSimilarity ${threshold}`, s.f1 === 1 ? "match" : "miss");
    }
    note(
      "There is no right answer there, and that is the point — it is a decision about your\n" +
        "domain, so the library makes you make it rather than picking silently.",
    );

    /**
     * `alignArraysBy` — index alignment is the default, and it is what you want for a
     * TABLE, where document order is meaningful. Key alignment is for a set where it is
     * not: a run that returned the right rows in a different order should not score 0.
     */
    const expectedRows = {
      lineItems: [{ code: "A", amount: 1 }, { code: "B", amount: 2 }],
    };
    const shuffled = { lineItems: [{ code: "B", amount: 2 }, { code: "A", amount: 1 }] };
    console.log("");
    field("shuffled rows, by index", scoreExtraction(expectedRows, shuffled).f1.toFixed(3));
    field(
      "shuffled rows, by code",
      scoreExtraction(expectedRows, shuffled, { alignArraysBy: "code" }).f1.toFixed(3),
    );

    // ── 5. The scoreboard ───────────────────────────────────────────────────────

    step("5. the scoreboard, over the whole corpus");

    const records: RunRecord[] = [];
    const rows: unknown[][] = [];

    for (const id of idsOfKind("invoice")) {
      const path = pathOf(id);
      const tPath = truthPathOf(id);
      const truth = tPath === undefined ? {} : await readPublishedTruth(tPath);

      const outcome = await extractor.safeExtract(path, Invoice);
      if (!outcome.ok) {
        rows.push([id, "no parser", "—", "—", claimedFields(truth).length]);
        continue;
      }

      const projected = projectOntoTruth(toScored(outcome.result.data as InvoiceData), truth);
      const documentScore = scoreExtraction(truth, projected);
      // `recordRun` pairs a score with the run that produced it, so the scoreboard can
      // report accuracy AND cost in one table.
      records.push(recordRun(id, documentScore, outcome.result));
      rows.push([
        id,
        outcome.result.method,
        documentScore.f1.toFixed(3),
        failures(documentScore).map((f) => f.path).join(",") || "—",
        claimedFields(truth).length,
      ]);
    }

    table(
      [
        { header: "document", width: 24 },
        { header: "answered by", width: 24 },
        { header: "F1", width: 6, right: true },
        { header: "fields missed", width: 20 },
        { header: "truth claims", width: 12, right: true },
      ],
      rows,
    );

    const summary = aggregate(records);
    console.log("");
    field("documents scored", `${summary.documents} of ${rows.length} in the corpus`);
    field("mean F1", summary.meanF1.toFixed(3));
    field("mean precision / recall", `${summary.meanPrecision.toFixed(3)} / ${summary.meanRecall.toFixed(3)}`);
    field("exact matches", summary.exactMatches);
    field("total tokens", summary.totalTokens.toLocaleString());
    field("total cost", summary.totalTokens === 0 ? "nothing — no model ran" : `$${summary.totalCostUsd.toFixed(4)}`);
    // The fallback picture, in one field: which strategy answered how often.
    field("byMethod", JSON.stringify(summary.byMethod));

    console.log(`\n  formatScoreboard(records):\n`);
    console.log(formatScoreboard(records));

    note(
      "Nine of eleven layouts have no parser, so they are not in the scoreboard at all —\n" +
        "which is the honest report. An eval that quietly averaged only what succeeded would\n" +
        "print a beautiful mean F1 for a pipeline that reads two documents in eleven.\n" +
        "Coverage and accuracy are two numbers and neither substitutes for the other.",
    );

    // ── 6. extractBatch ────────────────────────────────────────────────────────

    step("6. extractBatch — many documents, bounded concurrency");

    /**
     * An async generator, so each result is scored AS IT LANDS rather than after all of
     * them. `concurrency` matters: eleven simultaneous model calls is a rate-limit error
     * rather than a fast run.
     *
     * Each item carries its `index`, so pairing a result back to its input survives
     * out-of-order completion.
     */
    const ids = idsOfKind("invoice");
    const started = Date.now();
    let ok = 0;
    let failed = 0;

    for await (const item of extractor.extractBatch(
      ids.map((id) => pathOf(id)),
      Invoice,
      { concurrency: 4 },
    )) {
      // `outcome` is the same `SafeExtraction` shape `safeExtract` returns — a batch
      // must not fail because one document in it did.
      if (item.outcome.ok) ok += 1;
      else failed += 1;
      void item.index;
    }

    field("documents", ids.length);
    field("concurrency", 4);
    field("extracted", ok);
    field("fell through", failed);
    field("wall time", `${Date.now() - started} ms`);
    note(
      "A batch never rejects. `item.outcome` is `{ ok: true, result }` or\n" +
        "`{ ok: false, error }` per document, because one unreadable invoice in a nightly\n" +
        "run of forty thousand should not take the other 39,999 with it.",
    );

    console.log("\n  Next: 13-under-the-hood — below the facade.");
  } finally {
    await extractor.dispose();
  }
}

if (isMain(import.meta.url)) await run(main);
