import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { Extractor } from "docture/node";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { SplittingStrategy } from "docture";
import { expect, it } from "vitest";
import { runExample as quickStart } from "./index.js";
import { runExample as contracts } from "../contracts-and-schemas/index.js";
import { runExample as sources } from "../loaders-and-sources/index.js";
import { runExample as preview } from "../capabilities-and-composition/index.js";
import { runExample as plugins } from "../your-own-plugins/index.js";
import { runExample as csv } from "../your-own-plugins/custom-loader.js";
import { createExtractor, Invoice, runExample as fallback } from "../fallback-routing-and-errors/index.js";
import { runExample as modelExtraction } from "../with-a-model/index.js";
import { runExample as longDocument } from "../long-documents/index.js";
import { extractPages } from "../long-documents/paginated.js";
import { extractWithVision } from "../scanned-and-ocr/vision.js";
import { headingClassifier, KINDS, runExample as classify } from "../classification/index.js";
import { ACCOUNT_KINDS, bundleProcess, runExample as split } from "../bundles-and-splitting/index.js";
import { runExample as accuracy } from "../accuracy-and-batch/index.js";

function modelAnswer(answers: readonly unknown[]) {
  let index = 0;
  return new MockLanguageModelV4({
    provider: "example-test",
    modelId: "invoice-model",
    async doGenerate() {
      const answer = answers[index++];
      if (answer === undefined) throw new Error("The example sent an unexpected model request.");
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

it("extracts the bundled supply invoice and reports the actual loader and strategy", async () => {
  expect(await quickStart()).toEqual({
    data: { invoiceNumber: "INV-2026-0142", total: 717.3 },
    method: "supply-invoice", loader: "pdfjs",
  });
  expect(await contracts()).toEqual({ invoiceNumber: "INV-2026-0142", total: 717.3, customerTaxIdentifier: null });
});

it("reads the tax invoice total through both loaders and both source forms", async () => {
  const summary = { fromPath: { pages: [1], total: 17348.36 }, fromBytes: { pages: [1], total: 17348.36 } };
  expect(await sources()).toEqual({ pdfjs: summary, mupdf: summary });
});

it("writes a real first-page PNG through the composed renderer", async () => {
  const result = await preview();
  const bytes = await readFile(new URL("../capabilities-and-composition/output/page-1.png", import.meta.url));
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result).toMatchObject({ page: 1, lines: 29 });
  expect(result.image.widthPx).toBeGreaterThan(600);
  expect(result.image.heightPx).toBeGreaterThan(result.image.widthPx);
});

it("reads every supply line from PDF geometry and matching native CSV rows", async () => {
  const lineItems = [
    { description: "Copy paper A4, 80 g, box of 5 reams", quantity: 12, unitPrice: 24.9, amount: 298.8 },
    { description: "Ballpoint pens, blue (pack of 50)", quantity: 4, unitPrice: 11.25, amount: 45 },
    { description: "Desk organizer, bamboo", quantity: 6, unitPrice: 18.4, amount: 110.4 },
    { description: "Laser toner cartridge, black", quantity: 3, unitPrice: 64.99, amount: 194.97 },
    { description: "Delivery and handling", quantity: 1, unitPrice: 15, amount: 15 },
  ];
  expect(await plugins()).toEqual({ lineItems, total: 717.3 });
  for (const item of lineItems) expect(item.quantity * item.unitPrice).toBeCloseTo(item.amount, 2);
  expect(lineItems.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(664.17, 2);
  expect(await csv()).toEqual({ lineItems: [
    { sku: "PAP-A4-80", quantity: 12, amount: 298.8 },
    { sku: "PEN-BL-50", quantity: 4, amount: 45 },
    { sku: "ORG-BAM-1", quantity: 6, amount: 110.4 },
    { sku: "TON-BK-26", quantity: 3, amount: 194.97 },
    { sku: "SHIP", quantity: 1, amount: 15 },
  ] });
});

it("falls through the supply parser for the distinct tax layout and reports unsupported statements", async () => {
  const result = await fallback();
  expect(result.results.map((item) => [item.data.invoiceNumber, item.data.total, item.method])).toEqual([
    ["INV-2026-0142", 717.3, "supply-invoice"],
    ["INV-2026-0142", 17348.36, "tax-invoice"],
  ]);
  expect(result.results[1]?.attempts.map((attempt) => attempt.status)).toEqual(["failed", "ok"]);
  expect(result.unsupported).toContain("Every extraction strategy failed");
  await using extractor = createExtractor();
  const pinned = await extractor.safeExtract(
    fileURLToPath(new URL("../fallback-routing-and-errors/tax-invoice.pdf", import.meta.url)), Invoice,
    { only: ["supply-invoice"] },
  );
  expect(pinned.ok).toBe(false);
});

it("sends the actual invoice text through the AI SDK and validates its structured result", async () => {
  const answer = { invoiceNumber: "INV-2026-0142", total: 717.3, lineItems: [
    { description: "Copy paper A4, 80 g, box of 5 reams", quantity: 12, unitPrice: 24.9, amount: 298.8 },
    { description: "Ballpoint pens, blue (pack of 50)", quantity: 4, unitPrice: 11.25, amount: 45 },
    { description: "Desk organizer, bamboo", quantity: 6, unitPrice: 18.4, amount: 110.4 },
    { description: "Laser toner cartridge, black", quantity: 3, unitPrice: 64.99, amount: 194.97 },
    { description: "Delivery and handling", quantity: 1, unitPrice: 15, amount: 15 },
  ] };
  const model = modelAnswer([answer]);
  const result = await modelExtraction(model);
  expect(result.data).toEqual(answer);
  expect(result.usage.totalTokens).toBe(12);
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("Larkspur Sample Supply Co.");
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("INV-2026-0142");
});

it("chunks the six real pages and merges only the transaction table rows", async () => {
  const result = await longDocument();
  expect(result.pageChunks).toEqual([[1], [2], [3], [4], [5], [6]]);
  expect(result.budgetChunks.flat()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.transactions).toHaveLength(48);
  expect(result.transactions[0]).toEqual({ date: "06/28/2019", page: 1 });
  expect(result.transactions.at(-1)).toEqual({ date: "07/31/2019", page: 2 });
});

it("makes three paginated model requests and merges their arrays in page order", async () => {
  const first = { date: "2019-07-01", description: "Deposit" };
  const second = { date: "2019-07-09", description: "Deposit" };
  const model = modelAnswer([{ transactions: [first] }, { transactions: [second] }, { transactions: [] }]);
  const result = await extractPages(model);
  expect(result.data).toEqual({ transactions: [first, second] });
  expect(model.doGenerateCalls).toHaveLength(3);
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("TRUE CHECKING");
  expect(JSON.stringify(model.doGenerateCalls.map((call) => call.prompt))).not.toContain("READY RESERVE");
});

it("classifies both local documents and abstains when the right candidate is unavailable", async () => {
  expect(await classify()).toEqual([
    { file: "invoice.pdf", name: "invoice", confidence: 1 },
    { file: "statement.pdf", name: "bank-statement", confidence: 1 },
  ]);
  await using extractor = new Extractor({ loaders: [new DocumentLoaderPdfJs()], classifiers: [headingClassifier()] });
  const verdict = await extractor.classify(
    fileURLToPath(new URL("../classification/statement.pdf", import.meta.url)), [KINDS[0]],
  );
  expect(verdict.name).toBe("UNKNOWN");
});

it("splits checking, credit and unknown pages without losing the reconciliation page", async () => {
  const result = await split();
  expect(result.groups).toEqual([
    { pages: [1, 2, 3], classification: "checking-account" },
    { pages: [4, 5], classification: "credit-line" },
    { pages: [6], classification: "UNKNOWN" },
  ]);
  expect(result.documents).toEqual([
    { name: "checking-account", pages: [1, 2, 3], data: { accountNumber: "6547", endingBalance: 6682.22 } },
    { name: "credit-line", pages: [4, 5], data: { accountNumber: "3216", creditLimit: 1000 } },
  ]);
  const process = bundleProcess();
  try {
    await expect(process.loadFile(fileURLToPath(new URL("../bundles-and-splitting/statement.pdf", import.meta.url)))
      .split(ACCOUNT_KINDS, SplittingStrategy.LAZY).extract()).rejects.toThrow(/UNKNOWN/u);
  } finally {
    await process.dispose();
  }
});

it("scores both real invoices against adjacent complete truth files", async () => {
  expect(await accuracy()).toEqual([
    { file: "invoice.pdf", data: { invoiceNumber: "INV-2026-0142", total: 717.3 }, f1: 1 },
    { file: "tax-invoice.pdf", data: { invoiceNumber: "INV-2026-0142", total: 17348.36 }, f1: 1 },
  ]);
});

it("rejects model output that does not satisfy the invoice contract", async () => {
  await expect(modelExtraction(modelAnswer([{ invoiceNumber: "INV-2026-0142", total: "not money", lineItems: [] }])))
    .rejects.toThrow();
});

it("sends a rendered scanned page to the vision model", async () => {
  const answer = { accountNumber: "12345678", openingBalance: 69.96, closingBalance: 586.71 };
  const model = modelAnswer([answer]);
  expect(await extractWithVision(model)).toEqual(answer);
  expect(model.doGenerateCalls).toHaveLength(1);
  const content = model.doGenerateCalls[0]?.prompt.flatMap((message) => message.role === "user" ? message.content : []);
  const images = content?.flatMap((part) => part.type === "file" && part.data.type === "data"
    && part.data.data instanceof Uint8Array ? [{ mediaType: part.mediaType, length: part.data.data.length, signature: [...part.data.data.subarray(0, 8)] }] : []);
  expect(images).toHaveLength(1);
  expect(images?.[0]?.mediaType).toBe("image/png");
  expect(images?.[0]?.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(images?.[0]?.length).toBeGreaterThan(10_000);
});
