import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createExtractor, type FlexibleSchema, type LoadedDocument, type LoadedPage, type TextSpan } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader } from "docture/testing/doubles";

type Word = readonly [text: string, confidence?: number];

const FOOTER: readonly Word[] = "Thank you for your business, payment terms apply to every invoice"
  .split(" ").map((text) => [text, 0.99]);

function ocrPage(pageNumber: number, lines: readonly (readonly Word[])[]): LoadedPage {
  const textLines = [...lines, FOOTER].map((words, index) => {
    let x = 72;
    const spans = words.map(([text, confidence]): TextSpan => {
      const span = { text, x, y: 100 + index * 20, width: text.length * 6, height: 12 };
      x += text.length * 6 + 4;
      return confidence === undefined ? span : { ...span, confidence };
    });
    return { y: 100 + index * 20, height: 12, text: words.map(([text]) => text).join(" "), spans };
  });
  return { pageNumber, width: 612, height: 792, text: textLines.map((line) => line.text).join("\n"), lines: textLines };
}

function ocrDocument(pages: readonly (readonly (readonly Word[])[])[]): LoadedDocument {
  const loaded = pages.map((lines, index) => ocrPage(index + 1, lines));
  return { pages: loaded, text: loaded.map((page) => page.text).join("\f"), form: "scanned", loader: "fixture" };
}

function promptOf(prompt: unknown): string {
  return (prompt as { content: unknown }[]).map((message) => typeof message.content === "string"
    ? message.content
    : (message.content as { text?: string }[]).map((part) => part.text ?? "").join("\n")).join("\n");
}

function model(replies: readonly unknown[] | ((prompt: string) => unknown)): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: "mock-model",
    provider: "mock",
    async doGenerate(options) {
      const reply = typeof replies === "function" ? replies(promptOf(options.prompt)) : replies[Math.min(call, replies.length - 1)];
      call += 1;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(reply) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

async function cite<T>(
  document: LoadedDocument,
  schema: FlexibleSchema<T>,
  replies: readonly unknown[] | ((prompt: string) => unknown),
  completion: "forbidden" | "paginate" = "forbidden",
) {
  return createExtractor({
    loaders: [inMemoryLoader(document)],
    strategies: [llm({ model: model(replies), citations: true, completion })],
  }).extract({ loaded: document }, schema);
}

describe("OCR confidence on field citations", () => {
  it("takes the minimum over the matched occurrence, not the rest of its line", async () => {
    const document = ocrDocument([[
      [["Invoice", 0.95], ["INV-0042", 0.9], ["smudge", 0.2]],
      [["Total", 0.3], ["due:", 0.99], ["$1,234.50", 0.8]],
      [["Issued", 0.1], ["12", 0.97], ["March", 0.85], ["2024", 0.93], ["ref", 0.05]],
    ]]);
    const result = await cite(
      document,
      z.object({ invoice: z.string(), total: z.number(), issued: z.string(), invented: z.string(), note: z.string() }),
      [{
        data: { invoice: "INV-0042", total: 1234.5, issued: "2024-03-12", invented: "ACME", note: "n/a" },
        citations: [
          { path: "invoice", ids: ["p1-line-1"] },
          { path: "total", ids: ["p1-line-2"] },
          { path: "issued", ids: ["p1-line-3"] },
          { path: "invented", ids: ["p1-line-1"] },
        ],
      }],
    );

    expect(result.citations).toEqual([
      { path: "invoice", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.9 },
      { path: "total", status: "verified", ids: ["p1-line-2"], minOcrConfidence: 0.8 },
      { path: "issued", status: "verified", ids: ["p1-line-3"], minOcrConfidence: 0.85 },
      { path: "invented", status: "cited-unverified", ids: ["p1-line-1"], minOcrConfidence: 0.2 },
      { path: "note", status: "uncited", ids: [] },
    ]);
  });

  it("describes the first occurrence when a value appears more than once", async () => {
    const document = ocrDocument([[
      [["Qty", 0.99], ["10", 0.4], ["of", 0.99], ["10", 0.95]],
      [["Vendor", 0.99], ["ACME", 0.5]],
      [["Vendor", 0.99], ["ACME", 0.98]],
    ]]);
    const result = await cite(document, z.object({ quantity: z.number(), vendor: z.string() }), [{
      data: { quantity: 10, vendor: "ACME" },
      citations: [{ path: "quantity", ids: ["p1-line-1"] }, { path: "vendor", ids: ["p1-line-3", "p1-line-2"] }],
    }]);

    expect(result.citations).toEqual([
      { path: "quantity", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.4 },
      { path: "vendor", status: "verified", ids: ["p1-line-2"], minOcrConfidence: 0.5 },
    ]);
  });

  it("covers the words of a string matched across lines", async () => {
    const document = ocrDocument([[
      [["Consulting", 0.1], ["services", 0.8], ["for", 0.7]],
      [["the", 0.9], ["third", 0.6], ["quarter", 0.2]],
    ]]);
    const result = await cite(document, z.object({ description: z.string() }), [{
      data: { description: "services for the third" },
      citations: [{ path: "description", ids: ["p1-line-1", "p1-line-2"] }],
    }]);

    expect(result.citations).toEqual([
      { path: "description", status: "verified", ids: ["p1-line-1", "p1-line-2"], minOcrConfidence: 0.6 },
    ]);
  });

  it("reports a whole recognition region when the engine scores regions", async () => {
    const document = ocrDocument([[[["Total due 1,234.50", 0.77], ["Paid in full", 0.3]]]]);
    const result = await cite(document, z.object({ total: z.number() }), [{
      data: { total: 1234.5 },
      citations: [{ path: "total", ids: ["p1-line-1"] }],
    }]);

    expect(result.citations).toEqual([{ path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.77 }]);
  });

  it("falls back to the cited lines when the schema transformed a verified value", async () => {
    const document = ocrDocument([[[["Vendor", 0.4], ["acme", 0.9]]]]);
    const result = await cite(document, z.object({ vendor: z.string().transform((value) => value.toUpperCase()) }), [{
      data: { vendor: "acme" },
      citations: [{ path: "vendor", ids: ["p1-line-1"] }],
    }]);

    expect(result.data).toEqual({ vendor: "ACME" });
    expect(result.citations).toEqual([{ path: "vendor", status: "cited-unverified", ids: ["p1-line-1"], minOcrConfidence: 0.4 }]);
  });

  it("keeps the evidence through a paginated merge and the repair of the merged answer", async () => {
    const document = ocrDocument([
      [[["Total", 0.99], ["1,234.50", 0.66]]],
      [[["Vendor", 0.99], ["ACME", 0.75], ["Corp", 0.7]]],
    ]);
    const replies = (prompt: string) => {
      if (prompt.includes("sent to you in several parts")) return { total: 1234.5, vendor: "ACME Corp", currency: "USD" };
      if (prompt.includes("[p1-line-1] Total")) return { data: { total: 1234.5 }, citations: [{ path: "total", ids: ["p1-line-1"] }] };
      return { data: { vendor: "ACME Corp" }, citations: [{ path: "vendor", ids: ["p2-line-1"] }] };
    };
    const result = await cite(document, z.object({ total: z.number(), vendor: z.string(), currency: z.string() }), replies, "paginate");

    expect(result.attempts.map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(result.citations).toEqual([
      { path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.66 },
      { path: "vendor", status: "verified", ids: ["p2-line-1"], minOcrConfidence: 0.7 },
      { path: "currency", status: "uncited", ids: [] },
    ]);
  });

  it("measures a single repaired answer against the lines its repair cited", async () => {
    const document = ocrDocument([[[["Total", 0.99], ["7.00", 0.61], ["or", 0.2], ["-5", 0.3]]]]);
    const result = await cite(document, z.object({ total: z.number().refine((n) => n > 0) }), [
      { data: { total: -5 }, citations: [{ path: "total", ids: ["p1-line-1"] }] },
      { data: { total: 7 }, citations: [{ path: "total", ids: ["p1-line-1"] }] },
    ]);

    expect(result.data).toEqual({ total: 7 });
    expect(result.citations).toEqual([{ path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.61 }]);
  });

  it("never reports a confidence it cannot support", async () => {
    const document = ocrDocument([[
      [["Total", 0.9], ["10.00", Number.NaN]],
      [["Tax", 0.9], ["2.00", 1.5]],
      [["Fee", 0.9], ["3.00"]],
      [["Discount", 0.9], ["4.00", 0.8]],
      [["Unscored", 0.9], ["memo"]],
      [["Plain", 0.9], ["5.00", 0.9]],
    ]]);
    const lines = document.pages[0]?.lines ?? [];
    const misaligned = { ...lines[5]!, text: "Plain  text 5.00" };
    const broken: LoadedDocument = {
      ...document,
      pages: [{ ...document.pages[0]!, lines: [...lines.slice(0, 5), misaligned, ...lines.slice(6)] }],
    };
    const result = await cite(
      broken,
      z.object({
        total: z.number(), tax: z.number(), fee: z.number(), discount: z.number(),
        memo: z.string(), ghost: z.string(), plain: z.number(),
      }),
      [{
        data: { total: 10, tax: 2, fee: 3, discount: 4, memo: "Unscored", ghost: "x", plain: 5 },
        citations: [
          { path: "total", ids: ["p1-line-1"] },
          { path: "tax", ids: ["p1-line-2"] },
          { path: "fee", ids: ["p1-line-3"] },
          { path: "discount", ids: ["p1-line-4", "p1-line-5"] },
          { path: "memo", ids: ["p1-line-5", "p1-line-6"] },
          { path: "ghost", ids: ["p9-line-1"] },
          { path: "plain", ids: ["p1-line-6"] },
        ],
      }],
    );

    expect(result.citations).toEqual([
      { path: "total", status: "verified", ids: ["p1-line-1"] },
      { path: "tax", status: "verified", ids: ["p1-line-2"] },
      { path: "fee", status: "verified", ids: ["p1-line-3"] },
      { path: "discount", status: "verified", ids: ["p1-line-4"], minOcrConfidence: 0.8 },
      { path: "memo", status: "verified", ids: ["p1-line-5"], minOcrConfidence: 0.9 },
      { path: "ghost", status: "cited-unverified", ids: [] },
      { path: "plain", status: "verified", ids: ["p1-line-6"] },
    ]);
  });

  it("reports no confidence when a line's text is not its spans", async () => {
    const scanned = ocrDocument([[[["Tax", 0.99], ["99", 0.99]]]]);
    const page = scanned.pages[0]!;
    const [line, ...rest] = page.lines ?? [];
    const document: LoadedDocument = { ...scanned, pages: [{ ...page, lines: [{ ...line!, text: "Total 10" }, ...rest] }] };
    const result = await cite(document, z.object({ total: z.number() }), [{
      data: { total: 7 },
      citations: [{ path: "total", ids: ["p1-line-1"] }],
    }]);
    const pinned = await createExtractor({
      loaders: [inMemoryLoader(document)],
      strategies: [{
        name: "pinned",
        async extract() {
          return {
            data: { total: 10 },
            citations: [{ path: ["total"], status: "verified", ids: ["p1-line-1"], value: 10, spans: [{ line: "p1-line-1", span: 1 }] }],
          };
        },
      }],
    }).extract({ loaded: document }, z.object({ total: z.number() }));

    expect(result.citations).toEqual([{ path: "total", status: "cited-unverified", ids: ["p1-line-1"] }]);
    expect(pinned.citations).toEqual([{ path: "total", status: "verified", ids: ["p1-line-1"] }]);
  });

  it("reports no confidence for a text layer", async () => {
    const document = ocrDocument([[[["Total"], ["10.00"]]]]);
    const result = await cite(document, z.object({ total: z.number(), label: z.string() }), [{
      data: { total: 10, label: "Invoice" },
      citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "label", ids: ["p1-line-1"] }],
    }]);

    expect(result.citations).toEqual([
      { path: "total", status: "verified", ids: ["p1-line-1"] },
      { path: "label", status: "cited-unverified", ids: ["p1-line-1"] },
    ]);
  });
});
