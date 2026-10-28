/**
 * How to test a pipeline built on this library.
 *
 *     pnpm --filter @docture/examples test 14-testing
 *
 * Every test here runs offline with no API key and no downloaded document, in
 * milliseconds. That is the whole argument: the other examples read real documents
 * because a library that reads documents has to be shown reading them, but a TEST wants
 * the same bytes every time.
 *
 * Four sections, roughly in the order you would reach for them:
 *
 *   1. THE DOUBLES — testing wiring with no PDF at all
 *   2. GENERATED FIXTURES — a real PDF whose truth cannot drift from it
 *   3. CONFORMANCE — holding your own loader to the built-ins' invariants
 *   4. A MOCK MODEL — testing the model path without paying for it
 */

import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { ContractViolationError, NoEligibleStrategyError, DoctureError, contract, defineLoader, defineStrategy, linesFromWords, textFromLines, inferForm, type LoadedPage, type PositionedWord } from "docture";
import { Extractor } from "docture/node";
import { llm } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { scoreExtraction, formatFailures } from "docture/eval";
import { describeLoaderConformance } from "docture/testing/conformance";
import { failingStrategy, fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { z } from "zod";

/**
 * `inMemoryLoader` IGNORES the bytes it is handed and returns the document it was built
 * with, so any placeholder will do. It does have to be a real `DocumentSource` though —
 * a bare `LoadedDocument` is not one, and that is worth knowing because the mistake
 * typechecks nowhere and fails at run time with a confusing message.
 *
 * To skip the load stage entirely instead, pass `{ loaded: document }` — a
 * `LoadedSource`. Then no loader is consulted and no bytes are read at all.
 */
const ANY_BYTES = { bytes: new TextEncoder().encode("ignored"), mimeType: "text/plain" };

const Tiny = contract({
  name: "tiny",
  description: "Two fields, so the test is about the pipeline and not the schema.",
  schema: z.object({ invoiceNumber: z.string(), total: z.number() }),
});

// ── 1. The doubles ──────────────────────────────────────────────────────────────

describe("wiring, tested with no PDF at all", () => {
  /**
   * `loadedDocument` builds a `LoadedDocument` from strings and `inMemoryLoader` serves
   * it. Between them, a document is one line and costs nothing to parse.
   */
  const document = loadedDocument(["Invoice #A-1", "Total 42.00"]);

  it("routes to the first strategy that does not throw", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(
        failingStrategy("first", "not my layout"),
        failingStrategy("second", "nor mine"),
        fixedStrategy("third", { invoiceNumber: "A-1", total: 42 }),
      );

    const result = await extractor.extract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(result.method).toBe("third");
    // Order and reason, both. This is the assertion that would catch a fallback quietly
    // reordering itself.
    expect(result.attempts.map((a) => [a.strategy, a.status])).toEqual([
      ["first", "failed"],
      ["second", "failed"],
      ["third", "ok"],
    ]);
    expect(result.attempts[0]?.error).toBe("not my layout");
  });

  it("reports every strategy's error when they all fail", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(failingStrategy("a", "reason a"), failingStrategy("b", "reason b"));

    const outcome = await extractor.safeExtract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // `SafeExtraction`'s error is typed `Error`. Narrow to the library's base class to
      // reach `code` — which is what makes an exhaustive switch possible (example 06).
      expect(outcome.error).toBeInstanceOf(DoctureError);
      if (outcome.error instanceof DoctureError) {
        expect(outcome.error.code).toBe("EXTRACTION_FAILED");
      }
      expect(outcome.error.message).toContain("reason a");
      expect(outcome.error.message).toContain("reason b");
    }
  });

  it("does not run a strategy whose required facts the document lacks", async () => {
    /**
     * `loadedDocument` synthesises geometry by DEFAULT — one positioned line per newline
     * — so a GEOMETRY-requiring strategy would be eligible against `document` above.
     * `{ geometry: false }` is how you get the text-only case, and it is worth reaching
     * for deliberately: this is the difference between testing that a strategy handles
     * missing geometry and testing that it is never asked to.
     */
    const textOnly = loadedDocument(["Invoice #A-1", "Total 42.00"], { geometry: false });

    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(textOnly))
      .loadStrategy(
        defineStrategy({
          name: "needs-geometry",
          requires: ["GEOMETRY"],
          async extract() {
            throw new Error("this should never run");
          },
        }),
      );

    const outcome = await extractor.safeExtract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(NoEligibleStrategyError);
      expect(outcome.error.message).toContain("geometry=false");
    }
  });

  it("turns the wrong shape into a typed violation, not a crash", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      // A strategy that succeeds but produces the wrong thing. The PIPELINE validates,
      // not the strategy, so this is a contract violation rather than a parser bug.
      .loadStrategy(fixedStrategy("wrong-shape", { invoiceNumber: "A-1", total: "forty two" }));

    const outcome = await extractor.safeExtract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ContractViolationError);
      if (outcome.error instanceof ContractViolationError) {
        expect(outcome.error.issues.map((i) => i.path)).toContain("total");
      }
    }
  });
});

// ── 2. Generated fixtures ───────────────────────────────────────────────────────

describe("a real PDF whose truth cannot drift from it", () => {
  const Invoice = z.object({
    invoiceNumber: z.string(),
    issuedAt: z.string(),
    total: z.number(),
    lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
  });

  /** A deterministic parser for the generated layout. */
  const parser = defineStrategy({
    name: "synthetic-invoice-parser",
    requires: ["TEXT_LAYER", "GEOMETRY"],
    async extract(ctx) {
      const lines = ctx.document.pages.flatMap((page) => (page.lines ?? []).map((l) => l.text));
      const after = (label: string): string | undefined =>
        lines.find((l) => l.startsWith(label))?.slice(label.length).trim();
      const money = (text: string): number => Number(text.replace(/,/g, ""));

      const rows = lines
        .map((line) => /^(.*?#\d+)\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/.exec(line))
        .filter((m): m is RegExpExecArray => m !== null);

      const total = lines.find((l) => l.startsWith("TOTAL ("))?.match(/([\d,]+\.\d{2})\s*$/)?.[1];
      const number = after("Invoice Number:");
      if (number === undefined) throw new Error("not this layout");

      return {
        data: {
          invoiceNumber: number,
          issuedAt: after("Issue Date:"),
          total: total === undefined ? undefined : money(total),
          lineItems: rows.map((m) => ({ description: m[1]!.trim(), amount: money(m[4]!) })),
        },
      };
    },
  });

  const extractor = new Extractor()
    .loadDocumentLoader(new DocumentLoaderPdfJs())
    .loadStrategy(parser);

  it("scores 1.0 against truth generated from the same values", async () => {
    const pdf = await makeInvoicePdf({ seed: 301, lineItemCount: 5 });
    const result = await extractor.extract(pdf.bytes, Invoice);

    const score = scoreExtraction(
      {
        invoiceNumber: pdf.expected.invoiceNumber,
        issuedAt: pdf.expected.issuedAt,
        total: pdf.expected.total,
        lineItems: pdf.expected.lineItems.map((i) => ({
          description: i.description,
          amount: i.amount,
        })),
      },
      result.data,
    );

    expect(score.f1, formatFailures(score)).toBe(1);
    expect(result.usage.totalTokens).toBe(0);
  });

  it("holds up across several seeds", async () => {
    for (const seed of [302, 303, 304]) {
      const pdf = await makeInvoicePdf({ seed, lineItemCount: 6 });
      const data = await extractor.extractData(pdf.bytes, Invoice);
      expect(data.lineItems, `seed ${seed}`).toHaveLength(6);
    }
  });

  it("reads rows that spilled onto page 2", async () => {
    const pdf = await makeInvoicePdf({ seed: 307, lineItemCount: 45 });
    expect(pdf.pageCount).toBeGreaterThan(1);

    const data = await extractor.extractData(pdf.bytes, Invoice);
    expect(data.lineItems).toHaveLength(45);
  });

  it("refuses a textless page instead of inventing an answer", async () => {
    const pdf = await makeInvoicePdf({ seed: 308, textless: true });
    const outcome = await extractor.safeExtract(pdf.bytes, Invoice);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toMatch(/no extraction strategy is eligible/i);
      expect(outcome.error.message).toContain("textLayer=false");
    }
  });
});

// ── 3. Conformance ──────────────────────────────────────────────────────────────

/**
 * A toy loader, so this file can demonstrate the suite on something. In a real project
 * this is your loader, and this is the ONE call that holds it to the same invariants as
 * the four built-in ones — coordinate origin, line ordering, `form` reporting,
 * empty-page handling, disposal.
 */
const CSV_TYPE = "text/x-example-xy";

const xyLoader = defineLoader({
  name: "example-xy",
  capabilities: { text: true, geometry: true, images: false, mimeTypes: [CSV_TYPE, "*/*"] },
  async load(document) {
    const words: PositionedWord[] = [];
    for (const row of new TextDecoder().decode(document.bytes).split("\n")) {
      const [x, y, ...rest] = row.split(",");
      if (x === undefined || y === undefined || rest.length === 0) continue;
      const text = rest.join(",").trim();
      const left = Number(x);
      const top = Number(y);
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
      words.push({ text, box: [left, top, left + text.length * 6, top + 10] });
    }
    const lines = linesFromWords(words);
    const page: LoadedPage = {
      pageNumber: 1,
      width: 612,
      height: 792,
      text: textFromLines(lines),
      lines,
    };
    return {
      pages: [page],
      text: page.text,
      form: inferForm([page.text.trim().length]),
      loader: "example-xy",
    };
  },
});

/**
 * Pointing the suite at a loader is one call. It is commented out because this toy loader
 * reads a made-up format and the suite feeds it real PDFs — which is exactly the right
 * outcome: a loader that claims `*​/*` and cannot read a PDF should fail this.
 *
 * Uncomment it to watch that happen. For a real loader, this line is all you write.
 */
// describeLoaderConformance({ name: "example-xy", create: () => xyLoader });

describe("conformance", () => {
  it("is one call, and it is the point of the loader contract", () => {
    expect(typeof describeLoaderConformance).toBe("function");
    // The toy loader still works on its own format, which is all it claims.
    expect(xyLoader.capabilities.geometry).toBe(true);
  });
});

// ── 4. A mock model ─────────────────────────────────────────────────────────────

/**
 * The one place a mock model belongs.
 *
 * A runnable example must not mock — you came to see what a model does. A test is the
 * opposite: you know what the model would say, and what you are checking is that your
 * prompt assembly, schema and usage plumbing are right.
 *
 * `MockLanguageModelV4` is the AI SDK's own double, so the strategy still runs through
 * the real `generateText with Output.object` path with only the network replaced.
 */
function mockModel(answer: unknown, calls: { prompt: unknown }[] = []): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    async doGenerate(options) {
      calls.push({ prompt: options.prompt });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        // Provider spec v4 nests both of these, and getting either wrong fails QUIETLY:
        // a flat `usage` here reports zero tokens everywhere downstream.
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 300, text: 300, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

describe("the model path, without paying for it", () => {
  const document = loadedDocument([
    "INVOICE",
    "Invoice #M-9",
    "Total 99.50",
    // Enough text that the document clears MIN_TEXT_LAYER_CHARS and is not called a scan.
    "Thank you for your business. Payment is due within thirty days of the issue date.",
  ]);

  it("sends the document and returns the model's object, typed", async () => {
    const calls: { prompt: unknown }[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(
        llm({
          model: mockModel({ invoiceNumber: "M-9", total: 99.5 }, calls),
          pricing: { "mock-model": { inputPerMillion: 1, outputPerMillion: 4 } },
        }),
      );

    const result = await extractor.extract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(result.data.total).toBe(99.5);
    expect(calls).toHaveLength(1);
    // The document really was in the prompt. A test that only checked the return value
    // would pass against a strategy that sent an empty message.
    expect(JSON.stringify(calls[0]?.prompt)).toContain("M-9");
  });

  it("costs what the pricing table says", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(
        llm({
          model: mockModel({ invoiceNumber: "M-9", total: 99.5 }),
          pricing: { "mock-model": { inputPerMillion: 1, outputPerMillion: 4 } },
        }),
      );

    const result = await extractor.extract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(result.usage.inputTokens).toBe(1200);
    expect(result.usage.outputTokens).toBe(300);
    // 1200/1e6 * 1 + 300/1e6 * 4 = 0.0012 + 0.0012
    expect(result.usage.costUsd).toBeCloseTo(0.0024, 6);
  });

  it("leaves costUsd absent when there is no pricing table", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(llm({ model: mockModel({ invoiceNumber: "M-9", total: 99.5 }) }));

    const result = await extractor.extract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(result.usage.totalTokens).toBe(1500);
    // Absent, not zero. A zero would be indistinguishable from "it was free".
    expect(result.usage.costUsd).toBeUndefined();
  });

  it("lets a deterministic parser win before the model is asked", async () => {
    const calls: { prompt: unknown }[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader(inMemoryLoader(document))
      .loadStrategy(
        fixedStrategy("free-and-exact", { invoiceNumber: "M-9", total: 99.5 }),
        llm({ model: mockModel({ invoiceNumber: "WRONG", total: 0 }, calls) }),
      );

    const result = await extractor.extract(ANY_BYTES, Tiny);
    await extractor.dispose();

    expect(result.method).toBe("free-and-exact");
    // The assertion that matters: the model was never called at all.
    expect(calls).toHaveLength(0);
    expect(result.usage.totalTokens).toBe(0);
  });
});
