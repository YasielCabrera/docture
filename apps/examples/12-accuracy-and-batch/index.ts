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
 *   3. WHAT WENT WRONG — every field with its status, expected and actual value
 *   4. THE THREE TOLERANCES, and why each one exists
 *   5. THE SCOREBOARD, over the whole corpus, with `runEval` from `@docture/eval`
 *   6. `extractBatch` — many documents, bounded concurrency
 */

import { Extractor } from "docture/node";
import { inMemoryDataset, looseEval, OutOfScopeError, type CaseScore, type EvalExtractor, type FieldResult } from "@docture/eval";
import { fileDocument } from "@docture/eval/node";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { runEval } from "@docture/eval/runner";
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

/**
 * `looseEval` keeps the forgiving defaults this example teaches: numbers within a cent,
 * strings at similarity 0.9 once their digits agree, date-like strings by day, arrays by index.
 */
const loose = looseEval();
const misses = (score: CaseScore): readonly FieldResult[] => score.fields.filter((f) => f.status !== "match");
const hallucinations = (score: CaseScore): readonly FieldResult[] => score.fields.filter((f) => f.status === "hallucination");
const ratio = (value: number | null | undefined): string => (value === null || value === undefined ? "n/a" : value.toFixed(3));
const describeMisses = (score: CaseScore): string =>
  misses(score).map((f) => `    ${f.status.padEnd(13)} ${f.path}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`).join("\n");

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
    const score = loose.score(AZURE_INTERIOR, odoo);
    field("fields scored", score.fields.length);
    field("precision", ratio(score.metrics.precision));
    field("recall", ratio(score.metrics.recall));
    field("F1", ratio(score.metrics.f1));
    field("exact", score.metrics.exact);
    field("counts", JSON.stringify(score.counts));
    if (!score.metrics.exact) console.log(describeMisses(score));

    // ── 2. The trap ─────────────────────────────────────────────────────────────

    step("2. the trap that makes an eval lie to you");

    /**
     * The scorer counts a field the extraction produced and the truth OMITS as a
     * hallucination. That is exactly right for grading a real run — a model inventing a
     * `dueDate` is a serious fault, not a bonus.
     *
     * It also means an INCOMPLETE answer key punishes an extractor for being more
     * complete than the key. invoice2data publishes five comparable fields; our contract
     * has fourteen plus a line-item table. Score one against the other naively:
     */
    const truthPath = truthPathOf("invoice-odoo");
    const published = truthPath === undefined ? {} : await readPublishedTruth(truthPath);

    const naive = loose.score(published, odoo);
    const honest = loose.score(published, projectOntoTruth(toScored(odoo), published));

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
          ratio(naive.metrics.f1),
          hallucinations(naive).length,
          "meaningless",
        ],
        [
          "projected onto what truth claims",
          ratio(honest.metrics.f1),
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
    const servicesScore = loose.score(
      servicesTruth,
      projectOntoTruth(toScored(services), servicesTruth),
    );

    field("F1", ratio(servicesScore.metrics.f1));
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

    field("missed fields", misses(servicesScore).map((f) => f.path).join(", ") || "none");
    field("hallucinations", hallucinations(servicesScore).map((f) => f.path).join(", ") || "none");
    console.log(`\n  every miss, with both values:\n${describeMisses(servicesScore)}`);

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
    const tolerant = loose.score({ tax: 16.935 }, { tax: 16.94 });
    const strict = looseEval({ numericTolerance: 0 }).score({ tax: 16.935 }, { tax: 16.94 });
    field("16.935 vs 16.94, default", ratio(tolerant.metrics.f1));
    field("… with tolerance 0", ratio(strict.metrics.f1));

    /**
     * `stringSimilarity` — default 0.9. Forgives an OCR character slip in a long name
     * without accepting a different name. Section 3's vendor mismatch is exactly the
     * judgement call this knob exists for.
     */
    const pair = { vendor: "Sammy Maystone - For Lines testing" };
    const got = { vendor: "Sammy Maystone" };
    console.log("");
    for (const threshold of [0.9, 0.6, 0.4] as const) {
      const s = looseEval({ stringSimilarity: threshold }).score(pair, got);
      field(`stringSimilarity ${threshold}`, s.metrics.f1 === 1 ? "match" : "miss");
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
    field("shuffled rows, by index", ratio(loose.score(expectedRows, shuffled).metrics.f1));
    field(
      "shuffled rows, by code",
      ratio(looseEval({ alignArraysBy: "code" }).score(expectedRows, shuffled).metrics.f1),
    );

    // ── 5. The scoreboard ───────────────────────────────────────────────────────

    step("5. the scoreboard, over the whole corpus");

    /**
     * The corpus as eval cases: each invoice and its published truth. A processor turns a
     * case into output; one that has no parser for a layout declares the case OUT OF SCOPE,
     * so it is counted as skipped rather than averaged in as a zero or quietly dropped.
     */
    const cases = await Promise.all(idsOfKind("invoice").map(async (id) => {
      const tPath = truthPathOf(id);
      return { id, documents: [fileDocument(pathOf(id))], expected: tPath === undefined ? {} : await readPublishedTruth(tPath) };
    }));
    const truthOf = new Map(cases.map((item) => [item.id, item.expected]));
    const parsers: EvalExtractor = {
      id: "parsers",
      async extract(item) {
        const outcome = await extractor.safeExtract(pathOf(item.id), Invoice);
        if (!outcome.ok) throw new OutOfScopeError("no parser for this layout");
        const { method, usage } = outcome.result;
        return {
          // Grade only what each answer key claims, as section 2 showed.
          raw: projectOntoTruth(toScored(outcome.result.data as InvoiceData), truthOf.get(item.id) ?? {}),
          method,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        };
      },
    };
    const result = await runEval({ dataset: inMemoryDataset("published-invoices", cases), spec: loose, experiments: parsers });

    table(
      [
        { header: "document", width: 24 },
        { header: "answered by", width: 24 },
        { header: "F1", width: 6, right: true },
        { header: "fields missed", width: 20 },
        { header: "truth claims", width: 12, right: true },
      ],
      result.cases.map((row) => [
        row.caseId,
        row.outcome === "scored" ? (row.method ?? "—") : "no parser",
        row.outcome === "scored" ? ratio(row.score.metrics.f1) : "—",
        row.outcome === "scored" ? misses(row.score).map((f) => f.path).join(",") || "—" : "—",
        claimedFields(truthOf.get(row.caseId) ?? {}).length,
      ]),
    );

    const summary = result.summary["parsers"];
    console.log("");
    field("documents scored", `${summary?.cases.scored ?? 0} of ${summary?.cases.total ?? 0} in the corpus`);
    field("F1", ratio(summary?.overall["f1"]));
    field("precision / recall", `${ratio(summary?.overall["precision"])} / ${ratio(summary?.overall["recall"])}`);
    field("exact cases", ratio(summary?.overall["exactRate"]));
    field("skipped, no parser", ratio(summary?.overall["skipRate"]));
    field("total tokens", (summary?.overall["tokens"] ?? 0).toLocaleString());

    console.log(`\n  renderScoreboard(result):\n`);
    console.log(renderScoreboard(result));

    note(
      "Nine of eleven layouts have no parser, so they are SKIPPED, not scored —\n" +
        "which is the honest report. An eval that quietly averaged only what succeeded would\n" +
        "print a beautiful F1 for a pipeline that reads two documents in eleven.\n" +
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
