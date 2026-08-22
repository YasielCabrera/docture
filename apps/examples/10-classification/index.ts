/**
 * What kind of document is this?
 *
 *     pnpm --filter @docture/examples classify
 *     AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples classify
 *
 * Needs: `pnpm fetch`. The deterministic classifier runs with no key — a classifier is
 * an interface, not a wrapper around an LLM, and that is worth showing before the model
 * shows up. The `LlmClassifier` sections need a key.
 *
 * Read top to bottom:
 *
 *   1. A CLASSIFICATION carries its own schema — which is where the typing comes from
 *   2. NARROWING on `name` narrows `data` with it
 *   3. A CLASSIFIER WITH NO MODEL, over headings
 *   4. THE LLM CLASSIFIER
 *   5. TWO CLASSIFIERS DISAGREEING, and the three ways to settle it
 *   6. A TREE, because asking one model to choose between forty kinds is bad and dear
 */

import { readFile } from "node:fs/promises";
import {
  ClassificationStrategy,
  Extractor,
  loadDocument,
  silentLogger,
  classificationNode,
  classificationOf,
  classificationTree,
  defineClassification,
  defineClassifier,
  extractionContractOf,
  flattenTree,
  type ClassificationSignal,
  type Classifier,
} from "docture";
import { LlmClassifier } from "@docture/llm";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
import { z } from "zod";
import { CheckingSummary, CreditLineSummary, Invoice } from "../shared/contracts.js";
import { odooInvoiceParser } from "../shared/parsers/odoo.js";
import { servicesInvoiceParser } from "../shared/parsers/services.js";
import { checkingSummaryParser, creditLineParser } from "../shared/parsers/statement.js";
import { amount, field, heading, note, step, table } from "../shared/print.js";
import { pathOf } from "../shared/documents.js";
import { isMain, optionalModel, requireDocuments, run } from "../shared/run.js";
import type { LoadedDocument, LoadedSource } from "docture";

/**
 * A page range of an already-read document, as a source you can classify or extract.
 *
 * Worth knowing WHY this exists rather than a `pages` option: `extractor.classify`
 * takes `RunOptions`, and `RunOptions` has a `pages` field, but classification always
 * looks at the whole document — the filter is applied by the extraction pipeline, not
 * the classify path. Handing it a `LoadedSource` narrowed to the pages you mean is the
 * mechanism that does work, and it is the same one `Process` uses internally to extract
 * four documents out of one bundle without re-parsing it four times.
 *
 * `LoadedSource` skips the load stage entirely: no loader is consulted and no bytes are
 * read, because it has already been read.
 */
function pagesOf(document: LoadedDocument, pages: readonly number[]): LoadedSource {
  const wanted = new Set(pages);
  const kept = document.pages.filter((page) => wanted.has(page.pageNumber));
  return {
    loaded: {
      ...document,
      pages: kept,
      // Pages are joined by a form feed, which is the convention every loader here uses.
      text: kept.map((page) => page.text).join("\f"),
    },
    mimeType: "application/pdf",
  };
}

// ── 1. A classification carries its own schema ──────────────────────────────────

/**
 * `defineClassification` pins `name` to a LITERAL type. Without the `const` type
 * parameter `name: "invoice"` widens to `string`, and the narrowing in section 2 — the
 * entire payoff — silently stops working.
 */
const invoice = defineClassification({
  name: "invoice",
  description: "A commercial invoice: a vendor billing a customer for itemised goods.",
  // `Invoice.schema`, not `Invoice`: a classification takes a SCHEMA, while `Invoice` is
  // a contract wrapping one. `classificationOf(Invoice)` below does the unwrapping for
  // you, and is the shorter way to say this.
  schema: Invoice.schema,
  hints: "Look for an invoice number, a bill-to block and a line-item table.",
});

const checking = defineClassification({
  name: "checking-account",
  description: "A deposit account statement with a running transaction table.",
  schema: CheckingSummary,
});

const creditLine = defineClassification({
  name: "credit-line",
  description: "A revolving credit line statement with a limit and an interest charge.",
  schema: CreditLineSummary,
});

/** The three kinds, as a `const` tuple so the literal names survive into the result. */
const KINDS = [invoice, checking, creditLine] as const;

// ── 3. A classifier with no model ───────────────────────────────────────────────

/**
 * Every account and every invoice in this corpus announces itself in a heading. That is
 * a keyword problem, not a judgement problem, so it needs no model — and a classifier
 * that costs nothing can run on every document as a first pass.
 *
 * A classifier must NEVER throw. A broken one should not fail a document a later one, or
 * the fallback, could have handled — so it returns `null` to abstain and reports trouble
 * through the signal's `note`.
 */
/**
 * What each name looks like in the text. Ordered: the first match wins, so the narrow
 * patterns come before the broad ones.
 *
 * Table-driven rather than a chain of ifs, and for a reason that matters: a classifier is
 * handed `ctx.candidates` and must answer WITHIN them. The same classifier is asked
 * "invoice or statement?" at one level of the tree in section 6 and "checking or credit
 * line?" at the next, and it has to be right both times.
 */
const HEADINGS: readonly (readonly [name: string, pattern: RegExp, confidence: number])[] = [
  ["credit-line", /READY RESERVE/, 0.95],
  ["checking-account", /TRUE CHECKING/, 0.95],
  ["bank-statement", /READY RESERVE|TRUE CHECKING|ACCOUNT ACTIVITY SUMMARY/, 0.9],
  ["invoice", /\bINVOICE\b|\bInvoice\b|Faktura|Facture/, 0.8],
  // The family, so a tree can be walked from the root. Anything the narrower patterns
  // above matched is also financial.
  ["financial", /READY RESERVE|TRUE CHECKING|\bINVOICE\b|\bInvoice\b|Faktura|Facture/, 0.85],
];

export function headingClassifier(): Classifier {
  return defineClassifier({
    name: "heading-classifier",
    requires: ["TEXT_LAYER"],

    async classify(ctx) {
      const text = ctx.document.text;
      // Only the names on offer. Answering outside the candidate list is how a
      // classification result's literal type becomes a lie — core drops such a verdict,
      // but a well-behaved classifier should not produce one.
      const offered = new Set(ctx.candidates.map((c) => c.name));

      for (const [name, pattern, confidence] of HEADINGS) {
        if (offered.has(name) && pattern.test(text)) {
          return { classifier: "heading-classifier", name, confidence };
        }
      }

      // Abstain, but say why. A silent `null` and "I looked and found nothing" are
      // different facts, and the second one is the useful one at 3am.
      return {
        classifier: "heading-classifier",
        name: null,
        confidence: 0,
        note: `no heading matched any of: ${[...offered].join(", ")}`,
      };
    },
  });
}

async function main(): Promise<void> {
  const [odooPath, statementPath] = await requireDocuments("invoice-odoo", "statement");

  heading("Classification");

  step("1. a classification carries its own schema");

  table(
    [
      { header: "name", width: 20 },
      { header: "description", width: 46 },
      { header: "extracts against", width: 18 },
    ],
    KINDS.map((k) => [
      k.name,
      k.description.slice(0, 45),
      // `extractionContract` wins when a classification has one: recognising an invoice
      // needs two fields, extracting one needs forty, and keeping the classification
      // prompt cheap should not narrow the payload.
      extractionContractOf(k) === k.schema ? "its own schema" : "a wider contract",
    ]),
  );

  /** `classificationOf` builds one from a `contract`, so the name and prose are not restated. */
  const fromContract = classificationOf(Invoice);
  field("classificationOf(Invoice)", `name="${fromContract.name}"`);
  field("  reused the description", fromContract.description === Invoice.description);
  field("  reused the hints", fromContract.hints === Invoice.hints);

  // ── 2. Narrowing ─────────────────────────────────────────────────────────────

  step("2. classify, then narrow");

  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(
      odooInvoiceParser(),
      servicesInvoiceParser(),
      checkingSummaryParser(),
      creditLineParser(),
    )
    .loadClassifier(headingClassifier())
    .loadClassifications(...KINDS);

  // Read the statement ONCE. Both the classify calls and the extract calls below work
  // off these pages, so the six-page file is parsed a single time.
  const read = await loadDocument(
    [new DocumentLoaderPdfJs()],
    { bytes: new Uint8Array(await readFile(statementPath)), mimeType: "application/pdf" },
    silentLogger,
    AbortSignal.timeout(60_000),
    undefined,
  );
  const statement = read.document;

  try {
    for (const [label, source] of [
      ["the Odoo invoice", odooPath],
      ["statement pages 1-3", pagesOf(statement, [1, 2, 3])],
      ["statement pages 4-5", pagesOf(statement, [4, 5])],
      ["statement page 6", pagesOf(statement, [6])],
    ] as const) {
      const decided = await extractor.classify(source, KINDS);

      /**
       * THE PAYOFF. `decided.name` is a literal union of exactly the names passed, so
       * this switch is exhaustive and `decided.classification` narrows with it. Ask for
       * a name that is not a candidate and it will not compile.
       */
      let shape: string;
      switch (decided.name) {
        case "invoice":
          shape = "Invoice — invoiceNumber, lineItems, total";
          break;
        case "checking-account":
          shape = "CheckingSummary — endingBalance, transactionRows";
          break;
        case "credit-line":
          shape = "CreditLineSummary — creditLimit, availableCredit";
          break;
        case "UNKNOWN":
          shape = "nothing — no candidate matched";
          break;
      }

      field(label, `${decided.name} (${(decided.confidence * 100).toFixed(0)}%) → ${shape}`);
    }

    note(
      "`UNKNOWN` is in that union on purpose, and the compiler makes you handle it. A\n" +
        "classifier that answers 'Bill of Lading' when the candidates are invoice and\n" +
        "receipt does not get to win — the signal is still recorded so the disagreement\n" +
        "stays visible, but the literal type on the result would otherwise be a lie.",
    );

    // ── 3. The classifier, running ──────────────────────────────────────────────

    step("3. a classifier with no model");

    const rows: unknown[][] = [];
    for (const id of ["invoice-odoo", "invoice-aws", "statement"] as const) {
      const decided = await extractor.classify(pathOf(id), KINDS);
      rows.push([
        id,
        decided.name,
        `${(decided.confidence * 100).toFixed(0)}%`,
        decided.signals.map((s) => `${s.classifier}=${s.name ?? "abstain"}`).join(", "),
      ]);
    }
    table(
      [
        { header: "document", width: 16 },
        { header: "decided", width: 18 },
        { header: "confidence", width: 11, right: true },
        { header: "signals", width: 40 },
      ],
      rows,
    );

    // ── 3b. Classification driving extraction ───────────────────────────────────

    step("3b. and now the schema follows the verdict");

    /**
     * `needsClassification` on a strategy is how a strategy asks to be told. `"required"`
     * means it will not run without a verdict; `"hint"` means it will use one if there is
     * one; `"none"` — the default for the parsers here — means it does not care.
     *
     * The `classifications` option on the CALL overrides the extractor's defaults, which
     * is how one extractor serves several document populations.
     */
    for (const [label, pages] of [
      ["statement pages 1-3", [1, 2, 3]],
      ["statement pages 4-5", [4, 5]],
      ["statement page 6", [6]],
    ] as const) {
      const source = pagesOf(statement, pages);
      const decided = await extractor.classify(source, KINDS);

      if (decided.classification === undefined) {
        field(label, `${decided.name} → nothing to extract, and that is the right answer`);
        continue;
      }

      // The verdict CHOSE the contract. One extractor, one call site, three shapes.
      const result = await extractor.extract(source, extractionContractOf(decided.classification));
      const data = result.data as Record<string, unknown>;
      field(
        label,
        `${decided.name} → ${result.method} → account ${String(data["accountNumber"])}`,
      );
    }

    // ── 4. The LLM classifier ───────────────────────────────────────────────────

    step("4. the LLM classifier");

    const model = optionalModel();
    if (model === undefined) {
      note(
        "AI_GATEWAY_API_KEY is not set. `LlmClassifier` sends the first 4,000 characters —\n" +
          "the front matter decides it, and the rest is a table you are paying to read — plus\n" +
          "each candidate's `description` and `hints`, and asks for a name, a confidence and\n" +
          "one sentence of evidence.\n\n" +
          "  .loadClassifier(new LlmClassifier({ model, excerptChars: 4000 }))\n\n" +
          "Or, if the model is already wired for extraction, ask for it there:\n\n" +
          "  .loadLlm(model, { classify: true })",
      );
    } else {
      const withModel = new Extractor()
        .loadDocumentLoader(new DocumentLoaderPdfJs())
        .loadClassifier(new LlmClassifier({ model: model.model, excerptChars: 3000, temperature: 0 }))
        .loadClassifications(...KINDS);
      try {
        const llmRows: unknown[][] = [];
        for (const id of ["invoice-odoo", "invoice-aws", "statement"] as const) {
          const decided = await withModel.classify(pathOf(id), KINDS);
          llmRows.push([
            id,
            decided.name,
            `${(decided.confidence * 100).toFixed(0)}%`,
            decided.signals[0]?.note?.slice(0, 40) ?? "",
          ]);
        }
        table(
          [
            { header: "document", width: 16 },
            { header: "decided", width: 18 },
            { header: "confidence", width: 11, right: true },
            { header: "the model's evidence", width: 42 },
          ],
          llmRows,
        );
      } finally {
        await withModel.dispose();
      }
    }

    // ── 5. Disagreement ─────────────────────────────────────────────────────────

    step("5. two classifiers disagreeing, and three ways to settle it");

    /**
     * A second classifier that is confidently wrong. Contrived, but disagreement in
     * production is not — an OCR-quality classifier and a keyword one genuinely differ,
     * and "which one wins" should be a setting rather than an accident of registration
     * order.
     */
    const contrarian = defineClassifier({
      name: "contrarian",
      async classify() {
        return { classifier: "contrarian", name: "credit-line", confidence: 0.6 };
      },
    });
    const alsoContrarian = defineClassifier({
      name: "also-contrarian",
      async classify() {
        return { classifier: "also-contrarian", name: "credit-line", confidence: 0.55 };
      },
    });

    const settleRows: unknown[][] = [];
    for (const [strategy, options] of [
      [ClassificationStrategy.HIGHER_ORDER, {}],
      [ClassificationStrategy.CONSENSUS, {}],
      [ClassificationStrategy.CONSENSUS_WITH_THRESHOLD, { threshold: 0.9 }],
    ] as const) {
      const panel = new Extractor({
        loaders: [new DocumentLoaderPdfJs()],
        classifiers: [headingClassifier(), contrarian, alsoContrarian],
        classifications: [...KINDS],
        classify: { strategy, ...options },
      });
      try {
        const decided = await panel.classify(odooPath, KINDS);
        settleRows.push([
          strategy,
          "threshold" in options ? String(options.threshold) : "—",
          decided.name,
          `${(decided.confidence * 100).toFixed(0)}%`,
        ]);
      } finally {
        await panel.dispose();
      }
    }

    table(
      [
        { header: "strategy", width: 26 },
        { header: "threshold", width: 10 },
        { header: "winner on the invoice", width: 22 },
        { header: "confidence", width: 11, right: true },
      ],
      settleRows,
    );

    note(
      "One classifier says `invoice` at 0.80. Two say `credit-line` at 0.60 and 0.55.\n\n" +
        "  higherOrder             the single most confident verdict wins, however alone\n" +
        "  consensus               most votes wins; ties broken by summed confidence\n" +
        "  consensusWithThreshold  consensus, and every voter must also clear the bar\n\n" +
        "Every signal is on the result either way, so the disagreement is never lost — a\n" +
        "run where three classifiers agreed and a run where one guessed alone should not\n" +
        "look the same afterwards.",
    );

    // ── 6. A tree ───────────────────────────────────────────────────────────────

    step("6. a tree, because forty candidates is a bad prompt");

    /**
     * Asking one model to choose between forty document kinds is both expensive and bad.
     * Asking it to choose between three families, and then between the members of the
     * winner, is neither.
     */
    const financial = defineClassification({
      name: "financial",
      description: "Anything issued by a business about money owed or moved.",
      schema: z.object({ kind: z.string() }),
    });
    const bankStatement = defineClassification({
      name: "bank-statement",
      description: "A statement from a bank covering a period on one or more accounts.",
      schema: z.object({ kind: z.string() }),
    });

    const tree = classificationTree([
      classificationNode(financial, [
        classificationNode(invoice),
        classificationNode(bankStatement, [classificationNode(checking), classificationNode(creditLine)]),
      ]),
    ]);

    field("nodes at the root", tree.nodes.length);
    field("flattenTree() gives", flattenTree(tree).map((c) => c.name).join(", "));

    const walked = await extractor.classifyTree(pagesOf(statement, [4, 5]), tree);
    field("classifyTree, pages 4-5", walked.path.map((p) => p.name).join(" → "));
      field("the leaf", `${walked.leaf.name} at ${(walked.leaf.confidence * 100).toFixed(0)}%`);
    note(
      "One decision per level, each with a short candidate list. The path is returned as\n" +
        "well as the leaf, because 'it went financial → bank-statement → credit-line' is a\n" +
        "more useful thing to log than 'credit-line'.",
    );

    console.log("");
    const stillWorks = await extractor.extractData(odooPath, Invoice);
    field("and extraction still works", `Odoo invoice total ${amount(stillWorks.total)}`);

    console.log("\n  Next: 11-bundles-and-splitting — a file is not a document.");
  } finally {
    await extractor.dispose();
  }
}

if (isMain(import.meta.url)) await run(main);
