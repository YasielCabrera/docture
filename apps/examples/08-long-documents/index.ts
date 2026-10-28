/**
 * When one request is not enough.
 *
 *     pnpm --filter @docture/examples long
 *     AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples long
 *
 * Needs: `pnpm run fetch`. The first half runs with no key — the chunking and merging
 * helpers are pure functions and worth seeing on their own. The model runs need a key
 * and skip loudly without one.
 *
 * The document is the six-page bank statement: 48 transactions, 13,500 characters, and
 * a total on page 3 that has to reconcile against rows on page 1. That last part is why
 * splitting a document is not free.
 *
 * Read top to bottom:
 *
 *   1. HOW BIG IS IT, really — `estimateTokens`
 *   2. THE THREE COMPLETION STRATEGIES, and what each one sends
 *   3. WHY IT SPLITS AT PAGE BOUNDARIES and nowhere else
 *   4. `relaxJsonSchema` — a fragment cannot satisfy a whole-document schema
 *   5. `mergePartials` — folding the answers back together, and reporting conflicts
 *   6. THE MODEL, under all three strategies, with the request count
 */

import { readFile } from "node:fs/promises";
import { CompletionStrategy, contract, readDocument, silentLogger, type DocumentLoader } from "docture";
import { Extractor } from "docture/node";
import {
  chunkByBudget,
  chunkByPage,
  estimateTokens,
  llm,
  mergePartials,
  mergePartialsWithDiagnostics,
  relaxJsonSchema,
} from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { z } from "zod";
import { amount, field, heading, note, step, table } from "../shared/print.js";
import { isMain, optionalModel, requireDocument, run } from "../shared/run.js";

/**
 * A statement contract small enough that the difference between one request and six is
 * about the DOCUMENT rather than about the schema.
 */
const Statement = contract({
  name: "statement",
  description: "A bank statement: the account, and every transaction on it.",
  hints:
    "A transaction row shows one amount plus the running balance. Whether that amount " +
    "is a debit or a credit follows from whether the balance went down or up.",
  schema: z.object({
    accountNumber: z.string(),
    transactions: z
      .array(
        z.object({
          date: z.string().describe("ISO 8601 date, YYYY-MM-DD."),
          description: z.string(),
          amount: z.number(),
          balance: z.number(),
        }),
      )
      .min(1),
  }),
});

async function main(): Promise<void> {
  const path = await requireDocument("statement");

  heading("Long documents");

  // ── 1. How big is it, really ──────────────────────────────────────────────────

  step("1. how big is it, really");

  /**
   * `readDocument` is the load stage on its own — no strategy, no schema. Useful here
   * because the question is about the document, not about extracting from it.
   */
  // Typed as the interface, so the optional `dispose` is reachable.
  const loader: DocumentLoader = new DocumentLoaderPdfJs();
  const read = await readDocument(
    [loader],
    { bytes: new Uint8Array(await readFile(path)), mimeType: "application/pdf" },
    silentLogger,
    AbortSignal.timeout(60_000),
    undefined,
  );
  const document = read.document;

  field("pages", document.pages.length);
  field("characters", document.text.trim().length.toLocaleString());
  /**
   * Four characters per token. Deliberately crude: a real tokenizer is a dependency and
   * a startup cost, and the number is only ever used to decide whether to split.
   */
  field("estimateTokens(document)", estimateTokens(document.text).toLocaleString());
  console.log("");
  table(
    [
      { header: "page", width: 6, right: true },
      { header: "chars", width: 10, right: true },
      { header: "est. tokens", width: 12, right: true },
    ],
    document.pages.map((page) => [
      page.pageNumber,
      page.text.trim().length.toLocaleString(),
      estimateTokens(page.text).toLocaleString(),
    ]),
  );

  // ── 2. The three completion strategies ────────────────────────────────────────

  step("2. the three completion strategies");

  const byPage = chunkByPage(document);
  const byBudget = chunkByBudget(document, 6000);

  table(
    [
      { header: "completion", width: 15 },
      { header: "requests", width: 10, right: true },
      { header: "what each one sends", width: 44 },
    ],
    [
      [
        CompletionStrategy.FORBIDDEN,
        1,
        "the whole document. An error if it does not fit.",
      ],
      [
        CompletionStrategy.PAGINATE,
        byPage.length,
        `one page each: ${byPage.map((c) => c.pages.join()).join(" | ")}`,
      ],
      [
        CompletionStrategy.CONCATENATE,
        byBudget.length,
        `pages packed under 6,000 chars: ${byBudget.map((c) => c.pages.join("+")).join(" | ")}`,
      ],
    ],
  );

  note(
    "`FORBIDDEN` is the default, and it is the right default: most documents fit, and a\n" +
      "library that silently split them would make a cost report a guess. Asking for one\n" +
      "request and getting six is a decision you should have made on purpose.",
  );

  // ── 3. Why it splits at page boundaries ───────────────────────────────────────

  step("3. why it splits at page boundaries and nowhere else");

  /**
   * `chunkByBudget` splits only between pages, never inside one. A table row cut in half
   * yields two unparseable fragments and no merge rule recovers from that — so a single
   * page over budget is sent WHOLE. One oversized request that might work beats a
   * guaranteed-broken split.
   */
  const tiny = chunkByBudget(document, 500);
  table(
    [
      { header: "budget", width: 10, right: true },
      { header: "chunks", width: 8, right: true },
      { header: "largest chunk", width: 15, right: true },
      { header: "over budget?", width: 14 },
    ],
    [
      [
        "6,000",
        byBudget.length,
        Math.max(...byBudget.map((c) => c.text.length)).toLocaleString(),
        Math.max(...byBudget.map((c) => c.text.length)) > 6000 ? "yes" : "no",
      ],
      [
        "500",
        tiny.length,
        Math.max(...tiny.map((c) => c.text.length)).toLocaleString(),
        Math.max(...tiny.map((c) => c.text.length)) > 500 ? "yes — a whole page" : "no",
      ],
    ],
  );
  note(
    "Read the `largest chunk` column: 7,698 characters, in BOTH rows. That is page 6, and\n" +
      "it is over budget either way. The chunker sent it whole rather than cutting it,\n" +
      "because half a table is not half an answer — it is no answer, twice.\n\n" +
      "What the budget actually changed is the count: 2 chunks at 6,000, 6 at 500. Pages\n" +
      "get PACKED under the budget, never sliced to fit it.",
  );

  note(
    "A table that runs onto the next page loses its header there. The model runs in part\n" +
      "6 put it back: a request that starts on a page continuing a table from an earlier\n" +
      "page begins with \"Table header continued from page N:\", the header row, and a\n" +
      "line marking it as context. That text counts against the budget too.",
  );

  // ── 4. relaxJsonSchema ────────────────────────────────────────────────────────

  step("4. relaxJsonSchema — a fragment cannot satisfy a whole-document schema");

  /**
   * Here is the subtlety that makes multi-request extraction work at all.
   *
   * Page 4 of a statement has no `accountNumber` on it — that is on page 1. Send page 4
   * against the full schema and the model is being asked for a field the fragment does
   * not contain, so it either fails or invents one. Neither is acceptable.
   *
   * So every fragment request is sent against a RELAXED schema — `required` stripped,
   * types kept — and only the MERGE is validated against the real contract. "Any subset
   * is acceptable" is exactly true of a fragment, and exactly false of the whole.
   */
  const full = {
    type: "object",
    properties: {
      accountNumber: { type: "string" },
      transactions: {
        type: "array",
        items: {
          type: "object",
          properties: { date: { type: "string" }, amount: { type: "number" } },
          required: ["date", "amount"],
        },
      },
    },
    required: ["accountNumber", "transactions"],
  };

  const relaxed = relaxJsonSchema(full) as Record<string, unknown>;
  field("full: required", JSON.stringify(full.required));
  field("relaxed: required", String(relaxed["required"]));
  field("nested required gone too", JSON.stringify(relaxed).includes('"required"') ? "no" : "yes");
  field("types kept", JSON.stringify(relaxed).includes('"number"') ? "yes" : "no");
  note(
    "Types survive, requirements do not. The model still needs to know that `amount` is a\n" +
      "number for the fields it DID find.",
  );

  // ── 5. mergePartials ──────────────────────────────────────────────────────────

  step("5. mergePartials — folding the answers back together");

  /**
   * Three fragments, in document order. Arrays concatenate, scalars take the first
   * non-empty answer. That rule is what makes `paginate` produce one statement rather
   * than six.
   */
  const partials = [
    { accountNumber: "6547", transactions: [{ date: "2019-07-01", amount: 209.54 }] },
    { accountNumber: undefined, transactions: [{ date: "2019-07-02", amount: -21.7 }] },
    { accountNumber: null, transactions: [{ date: "2019-07-03", amount: -14.0 }] },
  ];
  const merged = mergePartials(partials) as {
    accountNumber: string;
    transactions: readonly unknown[];
  };
  field("three fragments in", partials.map((p) => p.transactions.length).join(" + "));
  field("transactions out", merged.transactions.length);
  field("accountNumber", `"${merged.accountNumber}" — page 1's, not page 3's null`);

  /**
   * When two pages give DIFFERENT present values, the first still wins, but the
   * disagreement is reported with the pages behind each value. A model run returns
   * the same list as `result.conflicts`.
   */
  const disagreeing = mergePartialsWithDiagnostics([
    { data: { closingBalance: 1187.84 }, pages: [3] },
    { data: { closingBalance: 978.3 }, pages: [6] },
  ]);
  field("closingBalance kept", JSON.stringify(disagreeing.data));
  field("conflicts", JSON.stringify(disagreeing.conflicts));

  // ── 6. The model, under all three ─────────────────────────────────────────────

  step("6. the model, under all three strategies");

  const model = optionalModel();
  if (model === undefined) {
    note(
      "AI_GATEWAY_API_KEY is not set, so this part is skipped — the chunk counts above are\n" +
        "what the model WOULD have been sent. Re-run with a key to see the token cost of\n" +
        "each strategy side by side:\n\n" +
        "  AI_GATEWAY_API_KEY=... pnpm --filter @docture/examples long",
    );
    console.log("\n  Next: 09-scanned-and-ocr — no text layer.");
    await loader.dispose?.();
    return;
  }

  const rows: unknown[][] = [];
  for (const completion of [
    CompletionStrategy.FORBIDDEN,
    CompletionStrategy.PAGINATE,
    CompletionStrategy.CONCATENATE,
  ] as const) {
    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderPdfJs())
      .loadStrategy(
        llm({
          model: model.model,
          name: completion,
          completion,
          maxCharsPerRequest: 6000,
          temperature: 0,
        }),
      );
    try {
      const outcome = await extractor.safeExtract(path, Statement);
      rows.push(
        outcome.ok
          ? [
              completion,
              `${outcome.result.data.transactions.length} transactions`,
              outcome.result.usage.totalTokens.toLocaleString(),
              `${outcome.result.usage.wallMs} ms`,
            ]
          : [completion, `failed: ${outcome.error.message.slice(0, 30)}`, "—", "—"],
      );
    } finally {
      await extractor.dispose();
    }
  }

  table(
    [
      { header: "completion", width: 15 },
      { header: "result", width: 22 },
      { header: "tokens", width: 10, right: true },
      { header: "wall", width: 10, right: true },
    ],
    rows,
  );

  note(
    "`paginate` costs more tokens than `forbidden` on a document that fits, because the\n" +
      "schema and system prompt are re-sent with every page. It is the right choice when\n" +
      "the document does NOT fit, and the wrong one when it does — which is why it is not\n" +
      "the default.\n\n" +
      "And the thing to watch for: a per-page request cannot see page 1 while reading page\n" +
      "3, so a total that has to reconcile against earlier rows is exactly what pagination\n" +
      "gets wrong. Reconcile the merge, as example 12 does.",
  );

  await loader.dispose?.();
  console.log("\n  Next: 09-scanned-and-ocr — no text layer.");
}

if (isMain(import.meta.url)) await run(main);
