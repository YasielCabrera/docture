/**
 * A file is not a document.
 *
 *     pnpm --filter @docture/examples bundles
 *     AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples bundles
 *
 * Needs: `pnpm run fetch`. The deterministic splitter runs with no key. The LLM splitters
 * need one and skip loudly.
 *
 * `statement.pdf` is not one document. Pages 1 to 3 are a checking account, pages 4 to 5
 * are a revolving credit line, and page 6 is a blank reconciliation form belonging to
 * neither. Extracting it as ONE document would mean asking a single schema to describe
 * all three, which is how a checking balance ends up in a credit-limit field.
 *
 * Read top to bottom:
 *
 *   1. `Process` — cut the file up, then extract each piece
 *   2. THE SPLIT IS REPORTED, including what deciding it cost
 *   3. NARROWING, again — and this is where it pays for itself
 *   4. PAGE 6 BELONGS TO NOBODY, and dropping it is a decision
 *   5. THE SPLITTER, which answers exactly one question
 *   6. EAGER vs LAZY, and the lower-level pieces underneath both
 *   7. THE LLM SPLITTERS, for when a heading is not enough
 */

import { Extractor, Process, SplittingStrategy, UNCLASSIFIED, UnclassifiedGroupError, aggregateDocGroups, defineClassification, defineSplitter, pageWindows, readDocument, runSplitter, silentLogger, type LoadedPage, type Splitter } from "docture";
import { ImageSplitter, TextSplitter } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { MuPdfRasterizer } from "docture/loaders/mupdf";
import { readFile } from "node:fs/promises";
import { CheckingSummary, CreditLineSummary } from "../shared/contracts.js";
import { checkingSummaryParser, creditLineParser } from "../shared/parsers/statement.js";
import { amount, field, heading, note, pageRange, step, table } from "../shared/print.js";
import { isMain, optionalModel, requireDocument, run } from "../shared/run.js";

// ── The two kinds this bundle can hold ──────────────────────────────────────────

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

/** In the order they appear in the file. */
export const ACCOUNT_KINDS = [checking, creditLine] as const;

// ── 5. The splitter ─────────────────────────────────────────────────────────────

/**
 * A splitter answers ONE question: "is page B a continuation of page A's document?"
 * Core does the folding.
 *
 * That division is deliberate. An image splitter and a text splitter genuinely disagree
 * about how to JUDGE a seam, and must not be able to disagree about what a run of "yes"
 * answers MEANS. The fold lives once, in `aggregateDocGroups`.
 *
 * This one reads headings, so it needs no model — `Splitter` is an interface, not a
 * wrapper around an LLM.
 */
export function accountSplitter(): Splitter {
  const kindOf = (page: LoadedPage): string | null => {
    if (/Account Reconciliation Form/.test(page.text)) return UNCLASSIFIED;
    if (/READY RESERVE/.test(page.text)) return "credit-line";
    if (/TRUE CHECKING/.test(page.text)) return "checking-account";
    return null;
  };

  return defineSplitter({
    name: "account-heading-splitter",
    requires: ["TEXT_LAYER"],

    async belongsToSameDocument(first, second, ctx) {
      const a = kindOf(first);
      const b = kindOf(second);
      // A page with no heading of its own continues whatever came before it.
      const resolved = b ?? a ?? UNCLASSIFIED;
      const known = new Set(ctx.classifications.map((c) => c.name));
      const name = (kind: string | null): string =>
        kind === null || !known.has(kind) ? UNCLASSIFIED : kind;

      return {
        belongsToSameDocument: b === null || b === a,
        classificationPage1: name(a),
        classificationPage2: name(resolved),
        confidence: 1,
      };
    },
  });
}

/** The whole wiring, in one function. Exported so the test drives exactly this. */
export function bundleProcess(): Process {
  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(checkingSummaryParser(), creditLineParser());

  return new Process().loadExtractor(extractor).loadSplitter(accountSplitter());
}

async function main(): Promise<void> {
  const path = await requireDocument("statement");

  heading("One file, three things in it");

  // ── 1. Process ────────────────────────────────────────────────────────────────

  step("1. cut the file up, then extract each piece");

  note(
    "Six lines of wiring, below. Everything printed from here on is what came back.\n" +
      "The whole point of `Process` is that this reads in one breath:\n\n" +
      "  await new Process()\n" +
      "    .loadExtractor(extractor)\n" +
      "    .loadSplitter(accountSplitter())\n" +
      "    .loadFile(path)\n" +
      "    .split(ACCOUNT_KINDS, SplittingStrategy.LAZY)\n" +
      '    .extract({ onUnclassified: "skip" });',
  );

  const process = bundleProcess();

  try {
    const documents = await process
      .loadFile(path)
      // `split` is LAZY. It records the plan and returns — nothing is read and no model
      // is called until `extract()`. So the chain reads in one breath, and it also
      // carries the classification list into the RETURN TYPE, which is section 3.
      .split(ACCOUNT_KINDS, SplittingStrategy.LAZY)
      // Page 6 matches neither kind. Dropping it is a DECISION, so it has to be spelled
      // out: the default is to fail rather than lose pages. Section 4 shows the default.
      .extract({ onUnclassified: "skip", concurrency: 2 });

    // ── 2. The split is reported ───────────────────────────────────────────────

    step("2. the split, reported");

    const split = process.lastSplit;
    field("splitter", split?.splitter ?? "?");
    field("strategy", split?.strategy ?? "?");
    console.log("");
    table(
      [
        { header: "pages", width: 12 },
        { header: "recognised as", width: 20 },
        { header: "extracted", width: 10 },
      ],
      (split?.groups ?? []).map((group) => [
        pageRange(group.pages),
        group.classification,
        documents.some((d) => d.pages.join() === group.pages.join()) ? "yes" : "skipped",
      ]),
    );

    /**
     * Splitting a 60-page scan is not free, and a cost report that omits it is wrong
     * rather than incomplete. This splitter reads headings, so it is zero — but the field
     * is there either way, which is the point.
     */
    console.log("");
    field(
      "split cost",
      split?.usage.totalTokens === 0
        ? "no tokens — this splitter reads headings"
        : `${split?.usage.totalTokens} tokens`,
    );
    field("the file was read", "once");
    field("documents out of it", documents.length);

    // ── 3. Narrowing ───────────────────────────────────────────────────────────

    step("3. narrowing, and this is where it pays");

    for (const document of documents) {
      console.log(`\n  ${document.name}, pages ${pageRange(document.pages)}`);

      /**
       * `document.data` is a DIFFERENT TYPE in each branch, and the compiler enforces
       * which fields each one has. Ask for `creditLimit` in the first branch and it will
       * not compile — which is the entire reason a classification carries its own schema.
       */
      if (document.name === "checking-account") {
        field("  account", `${document.data.accountType} ${document.data.accountNumber}`);
        field("  holder", document.data.accountHolder);
        field("  ending balance", amount(document.data.endingBalance));
        field("  transaction rows", document.data.transactionRows);
      } else {
        field("  account", `${document.data.accountType} ${document.data.accountNumber}`);
        field("  credit limit", amount(document.data.creditLimit));
        field("  available credit", amount(document.data.availableCredit));
        field("  interest this period", amount(document.data.interestChargedThisPeriod));
        field("  payment due", document.data.paymentDueDate ?? "not stated");
      }
      field("  answered by", document.result.method);
    }

    note(
      "Two schemas, two parsers, one loop, no casts. `d.pages` is on every document too,\n" +
        "so 'which pages did you think were the credit line?' is answerable — which is the\n" +
        "first question anyone asks when a number looks wrong.",
    );
  } finally {
    await process.dispose();
  }

  // ── 4. Page 6 belongs to nobody ───────────────────────────────────────────────

  step("4. page 6 belongs to nobody, and that is not a rounding error");

  /**
   * The default is `onUnclassified: "throw"`, deliberately: pages that fall out of a
   * bundle are exactly the ones nobody notices are missing. You have to say `"skip"`.
   */
  const strict = bundleProcess();
  try {
    await strict.loadFile(path).split(ACCOUNT_KINDS, SplittingStrategy.LAZY).extract();
    field("the default", "silently skipped it — that would be a bug");
  } catch (error) {
    if (error instanceof UnclassifiedGroupError) {
      field("error.code", error.code);
      field("message", error.message);
      note(
        "`UNCLASSIFIED` is the constant, and it is the string `\"UNKNOWN\"`. A group carrying\n" +
          "it is a group the splitter could not place — a real answer, not a failure, and\n" +
          "the caller decides whether losing it is acceptable.",
      );
    }
  } finally {
    await strict.dispose();
  }

  // ── 5b. splitOnly ─────────────────────────────────────────────────────────────

  step("5. ask where the seams are without paying to extract");

  /**
   * "Which pages are the invoice?" is worth being able to answer BEFORE paying to
   * extract forty of them.
   */
  const planner = bundleProcess();
  try {
    const report = await planner.loadFile(path).split(ACCOUNT_KINDS, SplittingStrategy.LAZY).splitOnly();
    field("groups found", report.groups.length);
    field("the cut", report.groups.map((g) => `${pageRange(g.pages)}=${g.classification}`).join("  "));
    field("nothing was extracted", "and nothing was paid for");
  } finally {
    await planner.dispose();
  }

  // ── 6. EAGER vs LAZY, and the pieces underneath ───────────────────────────────

  step("6. EAGER vs LAZY, and the pieces underneath both");

  const read = await readDocument(
    [new DocumentLoaderPdfJs()],
    { bytes: new Uint8Array(await readFile(path)), mimeType: "application/pdf" },
    silentLogger,
    AbortSignal.timeout(60_000),
    undefined,
  );
  const pages = read.document.pages;

  /**
   * `pageWindows` is the unit of work behind LAZY: adjacent, OVERLAPPING pairs, so every
   * seam appears in exactly one window. Six pages have five seams.
   */
  const windows = pageWindows(pages, 2);
  field("pages", pages.length);
  field("seams to judge (LAZY)", windows.length);
  field("windows", windows.map((w) => w.map((p) => p.pageNumber).join("+")).join(", "));
  field("requests (EAGER)", "1 — the whole bundle in one question");

  /**
   * `runSplitter` is the ONE place a `SplittingStrategy` is interpreted, and it is public
   * so you can drive a splitter without a `Process` at all.
   *
   * EAGER without a `splitEager` implementation degrades to LAZY rather than throwing —
   * the strategy is a performance preference, and losing it should not lose the answer.
   */
  for (const strategy of [SplittingStrategy.LAZY, SplittingStrategy.EAGER] as const) {
    const groups = await runSplitter(accountSplitter(), pages, strategy, {
      classifications: [...ACCOUNT_KINDS],
      signal: AbortSignal.timeout(60_000),
      logger: silentLogger,
    });
    field(
      `runSplitter(${strategy})`,
      groups.map((g) => `${pageRange(g.pages)}=${g.classification}`).join("  "),
    );
  }
  note(
    "`accountSplitter` implements only `belongsToSameDocument`, so EAGER falls back to\n" +
      "LAZY and both give the same cut. A model-backed splitter implements `splitEager`\n" +
      "too, and then EAGER is one request instead of five.",
  );

  /**
   * `aggregateDocGroups` is the shared fold. `pageCount` is passed rather than inferred
   * so the result is guaranteed to cover every page exactly once — a splitter that
   * returned too few verdicts truncates the last group instead of silently inventing a
   * page that does not exist.
   */
  console.log("");
  const handRolled = aggregateDocGroups(
    [
      { belongsToSameDocument: true, classificationPage1: "a", classificationPage2: "a" },
      { belongsToSameDocument: false, classificationPage1: "a", classificationPage2: "b" },
      { belongsToSameDocument: true, classificationPage1: "b", classificationPage2: "b" },
    ],
    4,
  );
  field("4 pages, yes/no/yes", handRolled.map((g) => `${pageRange(g.pages)}=${g.classification}`).join("  "));

  // ── 7. The LLM splitters ──────────────────────────────────────────────────────

  step("7. when a heading is not enough");

  const model = optionalModel();
  if (model === undefined) {
    note(
      "AI_GATEWAY_API_KEY is not set. Two built-in splitters implement the same interface\n" +
        "`accountSplitter` does:\n\n" +
        "  new TextSplitter({ model, excerptChars: 1200 })     // reads the top of each page\n" +
        "  new ImageSplitter({ model, dpi: 120 })              // LOOKS at each page\n\n" +
        "`ImageSplitter` declares `requires: [\"RENDERABLE_PAGES\"]`, so handing it a\n" +
        "text-only bundle fails at the wiring line rather than on page 40. It wants a\n" +
        "rasterizer composed onto the loader — example 04.\n\n" +
        "And the reason to reach for either: a scanned batch of eleven unrelated things has\n" +
        "no headings to read. A layout change IS the boundary, and that is something you\n" +
        "look at rather than parse.",
    );
  } else {
    const rows: unknown[][] = [];
    for (const [label, splitter] of [
      ["TextSplitter", new TextSplitter({ model: model.model, excerptChars: 1200, temperature: 0 })],
      ["ImageSplitter", new ImageSplitter({ model: model.model, dpi: 110, maxEdge: 1100, temperature: 0 })],
    ] as const) {
      const runner = new Process()
        .loadDocumentLoader(new DocumentLoaderPdfJs())
        .loadExtractor(
          new Extractor()
            .loadDocumentLoader(new DocumentLoaderPdfJs())
            .loadStrategy(checkingSummaryParser(), creditLineParser()),
        )
        .loadSplitter(splitter);
      try {
        const report = await runner
          .loadFile(path)
          .split(ACCOUNT_KINDS, SplittingStrategy.EAGER)
          .splitOnly();
        rows.push([
          label,
          report.groups.map((g) => pageRange(g.pages)).join(" | "),
          report.usage.totalTokens.toLocaleString(),
          report.usage.costUsd === undefined ? "—" : `$${report.usage.costUsd.toFixed(5)}`,
        ]);
      } catch (error) {
        rows.push([label, `failed: ${(error as Error).message.slice(0, 24)}`, "—", "—"]);
      } finally {
        await runner.dispose();
      }
    }
    table(
      [
        { header: "splitter", width: 14 },
        { header: "the cut it found", width: 26 },
        { header: "tokens", width: 10, right: true },
        { header: "cost", width: 10, right: true },
      ],
      rows,
    );
    note("Note the cost column. That is the number a report which only counted extraction would miss.");
  }

  console.log("\n  Next: 12-accuracy-and-batch — is it right, and what did it cost?");
}

if (isMain(import.meta.url)) await run(main);
