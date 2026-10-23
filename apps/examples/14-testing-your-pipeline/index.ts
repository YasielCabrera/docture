/**
 * The test kit.
 *
 *     pnpm --filter @docture/examples test
 *
 * Needs: nothing. No download, no key, no network — which is the whole point of this
 * example. A test corpus that needs a network is a test corpus that fails on a plane.
 *
 * Most other examples run on downloaded real documents, because a library that
 * reads documents is only convincing on documents somebody actually issued. Tests are
 * the exception: there you want the SAME bytes every time, generated from the same
 * values as the expected output, so the answer key cannot drift from the document.
 *
 * There is no `index.ts` worth running here — the example IS the test file. Read
 * `pipeline.test.ts` next door, then run it:
 *
 *     pnpm --filter @docture/examples test 14-testing
 *
 * This file is a summary of what is in there and why.
 */

import { buildInvoiceData, formatMoney, makeInvoicePdf } from "docture/testing/fixtures";
import { field, heading, note, step, table } from "../shared/print.js";
import { isMain, run } from "../shared/run.js";

async function main(): Promise<void> {
  heading("Testing a pipeline built on this library");

  // ── 1. Generated fixtures ─────────────────────────────────────────────────────

  step("1. a real PDF and its ground truth, from the same values");

  /**
   * `makeInvoicePdf` renders a real PDF with a real text layer AND returns the data it
   * rendered. Because both come from one seed, the expected output cannot drift from the
   * bytes — the failure mode where a fixture is updated and its `.json` is not simply
   * cannot happen.
   */
  const pdf = await makeInvoicePdf({ seed: 7, lineItemCount: 5 });
  field("bytes", `${(pdf.bytes.length / 1024).toFixed(1)} KB of real PDF`);
  field("pages", pdf.pageCount);
  field("expected.invoiceNumber", pdf.expected.invoiceNumber);
  field("expected.lineItems", pdf.expected.lineItems.length);
  field("expected.total", formatMoney(pdf.expected.total));

  /** Same seed, same bytes. That is what makes a golden test possible. */
  const again = await makeInvoicePdf({ seed: 7, lineItemCount: 5 });
  field("same seed → same truth", JSON.stringify(again.expected) === JSON.stringify(pdf.expected));
  field("different seed → different", buildInvoiceData({ seed: 8 }).invoiceNumber !== pdf.expected.invoiceNumber);

  step("2. the two shapes that are hard to find real examples of");

  /**
   * Both of these are a nuisance to source as real documents and trivial to generate,
   * which is exactly the right division of labour between this and `documents/`.
   */
  const long = await makeInvoicePdf({ seed: 11, lineItemCount: 45 });
  const scanned = await makeInvoicePdf({ seed: 12, textless: true });

  table(
    [
      { header: "fixture", width: 32 },
      { header: "pages", width: 7, right: true },
      { header: "what it is for", width: 34 },
    ],
    [
      ["makeInvoicePdf({ lineItemCount: 45 })", long.pageCount, "multi-page, rows that span a break"],
      ["makeInvoicePdf({ textless: true })", scanned.pageCount, "no text layer — the scanned case"],
      ["buildInvoiceData({ seed })", "—", "the truth alone, with no PDF"],
    ],
  );

  step("3. and the doubles, for when you do not want a PDF at all");

  note(
    "Most of what you want to test about a pipeline is the WIRING — does the fallback\n" +
      "fire, is the error the right error, did the classifier get consulted. None of that\n" +
      "needs a PDF, and parsing one makes the test slower and the failure less specific.\n\n" +
      "  loadedDocument(pages)          a LoadedDocument from strings\n" +
      "  inMemoryLoader(document)       a DocumentLoader that returns it\n" +
      "  fixedStrategy(name, data)      a strategy that always succeeds\n" +
      "  failingStrategy(name, message) a strategy that always throws\n\n" +
      "Four functions, and between them every routing case in this library is testable in\n" +
      "milliseconds with no bytes involved.",
  );

  step("4. conformance — the suite that makes loaders interchangeable");

  note(
    "The built-in loaders under docture/loaders/* run the SAME suite against their classes:\n\n" +
      "  describeLoaderConformance({\n" +
      '    name: "MyLoader",\n' +
      "    create: () => new MyLoader(),\n" +
      "  });\n\n" +
      "One call, and your loader is held to the invariants the built-in four are held to —\n" +
      "coordinate origin, line ordering, `form` reporting, empty-page handling, disposal.\n" +
      "That is what makes swapping libraries a tested guarantee rather than an interface\n" +
      "coincidence. `describeRasterizerConformance` does the same for a rasterizer.",
  );

  step("5. testing the model path without paying for it");

  note(
    "This is the ONE place a mock model belongs, and the reason is worth being precise\n" +
      "about. A runnable example must not mock: you came to see what a model does, and a\n" +
      "scripted answer would teach you the wiring and lie about the result. A TEST is the\n" +
      "opposite — you already know what the model would say, and what you want to check is\n" +
      "that your prompt assembly, schema and merge logic are right.\n\n" +
      "`MockLanguageModelV4` from `ai/test` is the AI SDK's own double, so the strategy is\n" +
      "still exercised through the real `generateObject` code path — real prompt assembly,\n" +
      "real structured-output parsing, real usage plumbing — with only the network\n" +
      "replaced. `pipeline.test.ts` uses it; `packages/docture/test/llm/mock-model.ts` is the\n" +
      "fuller version this library tests itself with.",
  );

  console.log("\n  Now read 14-testing-your-pipeline/pipeline.test.ts, and run:");
  console.log("    pnpm --filter @docture/examples test 14-testing\n");
  console.log("  Next: 15-cli — the same library from a terminal.");
}

if (isMain(import.meta.url)) await run(main);
