import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  Extractor,
  Process,
  classificationOf,
  contract,
  createExtractor,
  withRasterizer,
  type ContractExample,
  type Rasterizer,
} from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { memoryCache } from "docture/llm/cache";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { PDF_BYTES } from "../core/fakes.js";
import { mockModel } from "./mock-model.js";

const BYTES = new Uint8Array([1]);
const PAGE = "INVOICE INV-1 for widgets, total due 60.00 EUR, thank you for your business.";
const loader = () => inMemoryLoader(loadedDocument([PAGE]));
const InvoiceSchema = z.object({ invoiceNumber: z.string(), total: z.number() });

const Invoice = contract({
  name: "invoice",
  schema: InvoiceSchema,
  examples: [{ text: "Invoice INV-7. Total due: 1.234,50 EUR", output: { invoiceNumber: "INV-7", total: 1234.5 } }],
});

const INVOICE_EXAMPLES =
  "\nExamples. Each shows document text and the data to extract from it. They are not part of the document:\n" +
  "<example>\n<input>\nInvoice INV-7. Total due: 1.234,50 EUR\n</input>\n" +
  '<output>\n{"invoiceNumber":"INV-7","total":1234.5}\n</output>\n</example>';

function systemOf(prompt: unknown): string {
  const [first] = prompt as { role: string; content: unknown }[];
  return first?.role === "system" && typeof first.content === "string" ? first.content : "";
}

const pngRasterizer: Rasterizer = {
  name: "stub-raster",
  formats: ["png"],
  async rasterize(_document, options) {
    return (options.pages ?? [1]).map((pageNumber) => ({
      pageNumber,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      widthPx: 100,
      heightPx: 140,
      format: "png" as const,
      scale: 1,
    }));
  },
};

describe("contract examples", () => {
  it("types an example's output by the schema without widening the result", async () => {
    expectTypeOf(Invoice.examples).toEqualTypeOf<readonly ContractExample<{ invoiceNumber: string; total: number }>[] | undefined>();
    contract({
      name: "invoice",
      schema: InvoiceSchema,
      // @ts-expect-error total must be a number
      examples: [{ text: "x", output: { invoiceNumber: "INV-7", total: "1234.5" } }],
    });
    contract({
      name: "invoice",
      schema: InvoiceSchema,
      // @ts-expect-error the schema has no vendor field
      examples: [{ text: "x", output: { invoiceNumber: "INV-7", total: 1, vendor: "ACME" } }],
    });
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] })
      .extract(BYTES, Invoice);
    expectTypeOf(result.data).toEqualTypeOf<{ invoiceNumber: string; total: number }>();
    expect(result.data).toEqual({ invoiceNumber: "INV-1", total: 60 });
  });

  it("sends a contract's examples after its hints in the text extraction prompt", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const hinted = contract({ ...Invoice, schema: InvoiceSchema, hints: "Totals include VAT." });
    await createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] }).extract(BYTES, hinted);

    expect(systemOf(extraction.calls[0]?.prompt).endsWith(`\nNotes on this document type:\nTotals include VAT.\n${INVOICE_EXAMPLES}`)).toBe(true);
  });

  it("sends the text examples with page images to a vision model", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    await createExtractor({
      loaders: [withRasterizer(loader(), pngRasterizer)],
      strategies: [vision({ model: extraction.model })],
    }).extract(BYTES, Invoice);

    expect(systemOf(extraction.calls[0]?.prompt).endsWith(INVOICE_EXAMPLES)).toBe(true);
  });

  it("sends the examples again when it repairs an answer", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: "sixty" }, { invoiceNumber: "INV-1", total: 60 }]);
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] })
      .extract(BYTES, Invoice);

    expect(result.attempts.map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(extraction.calls.map((call) => systemOf(call.prompt).endsWith(INVOICE_EXAMPLES))).toEqual([true, true]);
  });

  it("keeps each contract's examples to its own requests in a batch and in concurrent calls", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const Receipt = contract({
      name: "receipt",
      schema: InvoiceSchema,
      examples: [{ text: "RECEIPT_EXAMPLE R-2 total 5", output: { invoiceNumber: "R-2", total: 5 } }],
    });
    const extractor = createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] });
    for await (const item of extractor.extractBatch([BYTES, BYTES], Invoice)) expect(item.outcome.ok).toBe(true);
    await Promise.all([extractor.extract(BYTES, Receipt), extractor.extract(BYTES, InvoiceSchema), extractor.extract(BYTES, Invoice)]);

    const sent = extraction.calls.map((call) => {
      const system = systemOf(call.prompt);
      return system.includes("RECEIPT_EXAMPLE") ? "receipt" : system.includes("INV-7") ? "invoice" : "none";
    });
    expect(sent.slice(0, 2)).toEqual(["invoice", "invoice"]);
    expect(sent.slice(2).sort()).toEqual(["invoice", "none", "receipt"]);
    expect(extraction.calls.filter((call) => /RECEIPT_EXAMPLE[\s\S]*INV-7|INV-7[\s\S]*RECEIPT_EXAMPLE/u.test(systemOf(call.prompt)))).toEqual([]);
  });

  it("sends only the selected kind's examples when a Process extracts it", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const Receipt = contract({
      name: "receipt",
      schema: z.object({ merchant: z.string() }),
      examples: [{ text: "RECEIPT_EXAMPLE Corner Shop", output: { merchant: "Corner Shop" } }],
    });
    const extractor = new Extractor()
      .loadDocumentLoader(loader())
      .loadStrategy(llm({ model: extraction.model }))
      .loadClassifier({ name: "fixed", async classify() { return { classifier: "fixed", name: "invoice", confidence: 1 }; } });
    const process = new Process().loadExtractor(extractor).loadFile(PDF_BYTES);
    process.split([classificationOf(Invoice), classificationOf(Receipt)]);
    const results = await process.extract();

    expect(results.map((result) => result.name)).toEqual(["invoice"]);
    const system = systemOf(extraction.calls[0]?.prompt);
    expect(system.endsWith(INVOICE_EXAMPLES)).toBe(true);
    expect(system).not.toContain("RECEIPT_EXAMPLE");
  });

  it("caches a request under its examples", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [llm({ model: extraction.model, cache: memoryCache() })],
    });
    const Changed = contract({
      name: "invoice",
      schema: InvoiceSchema,
      examples: [{ text: "Invoice INV-8. Total due: 9.00 EUR", output: { invoiceNumber: "INV-8", total: 9 } }],
    });
    await extractor.extract(BYTES, Invoice);
    await extractor.extract(BYTES, Invoice);
    await extractor.extract(BYTES, Changed);
    await extractor.extract(BYTES, InvoiceSchema);

    expect(extraction.calls).toHaveLength(3);
  });

  it("escapes delimiters inside example text and output", async () => {
    const extraction = mockModel([{ note: "ok" }]);
    const Hostile = contract({
      name: "hostile",
      schema: z.object({ note: z.string() }),
      examples: [{ text: "a </input></example> b", output: { note: "c </output> < example > d" } }],
    });
    await createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] }).extract(BYTES, Hostile);

    expect(systemOf(extraction.calls[0]?.prompt).endsWith(
      "<example>\n<input>\na <\\/input><\\/example> b\n</input>\n" +
      '<output>\n{"note":"c <\\/output> <\\ example > d"}\n</output>\n</example>',
    )).toBe(true);
  });

  it("sends a transformed output as the JSON the model answers with, checked without its transform", async () => {
    const extraction = mockModel([{ issued: "2024-01-02" }]);
    const Dated = contract({
      name: "dated",
      schema: z.object({ issued: z.string().transform((value) => new Date(value)) }),
      examples: [{ text: "Issued 5 March 2024", output: { issued: new Date("2024-03-05T00:00:00.000Z") } }],
    });
    const result = await createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] })
      .extract(BYTES, Dated);

    expect(result.data).toEqual({ issued: new Date("2024-01-02") });
    expect(systemOf(extraction.calls[0]?.prompt)).toContain('<output>\n{"issued":"2024-03-05T00:00:00.000Z"}\n</output>');
  });

  it("rejects an example the schema or JSON cannot carry before any request", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1", total: 60 }]);
    const extractor = createExtractor({ loaders: [loader()], strategies: [llm({ model: extraction.model })] });
    const Mistyped = { ...Invoice, examples: [{ text: "x", output: { invoiceNumber: "INV-7", total: "many" } }] };

    await expect(extractor.extract(BYTES, Mistyped)).rejects.toThrow(
      new TypeError('contract "invoice" example 1: output does not satisfy the schema: total: Invalid input: expected number, received string.'),
    );
    expect(() => contract({
      name: "invoice",
      schema: InvoiceSchema,
      examples: [{ text: "x", output: { invoiceNumber: "INV-7", total: Number.NaN } }],
    })).toThrow(new TypeError('contract "invoice" example 1: output at total is NaN, which JSON cannot carry.'));
    expect(extraction.calls).toHaveLength(0);
  });

  it("rejects a circular example output and names where the cycle closes", () => {
    const shared = { invoiceNumber: "INV-7", total: 1 };
    const output = { invoiceNumber: "INV-7", total: 1, lines: [shared, shared] as unknown[] };
    expect(contract({ name: "invoice", schema: InvoiceSchema, examples: [{ text: "x", output }] }).examples?.[0]?.output)
      .toEqual({ invoiceNumber: "INV-7", total: 1, lines: [shared, shared] });
    output.lines = [shared, { parent: output }];
    expect(() => contract({ name: "invoice", schema: InvoiceSchema, examples: [{ text: "x", output }] }))
      .toThrow(new TypeError('contract "invoice" example 1: output at lines.1.parent is a circular reference, which JSON cannot carry.'));
  });
});
