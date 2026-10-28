import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  contract,
  createExtractor,
  defineClassification,
  defineStrategy,
  withRasterizer,
  silentLogger,
  TimeoutError,
  type Classification,
  type Classifier,
  type Rasterizer,
  type RunOptions,
  type Logger,
} from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { LlmClassifier } from "docture/llm/classifier";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { mockModel } from "./mock-model.js";

const Invoice = z.object({ invoiceNumber: z.string() });
const BYTES = new Uint8Array([1]);
const loader = () => inMemoryLoader(loadedDocument(["INVOICE INV-1 for widgets, total due 60.00 EUR, thank you."]));

const receipt = defineClassification({
  name: "receipt", description: "A receipt", hints: "RECEIPT_ONLY_HINT", schema: z.object({ merchant: z.string() }),
});
const statement = defineClassification({
  name: "statement", description: "A statement", hints: "STATEMENT_ONLY_HINT", schema: z.object({ balance: z.number() }),
});
const hintedInvoice = contract({ name: "invoice", hints: "INVOICE_CONTRACT_HINT", schema: Invoice });

function fixedClassifier(name: string | null): Classifier {
  return { name: "fixed", async classify() { return { classifier: "fixed", name, confidence: 1 }; } };
}

function hintRecorder() {
  const seen: (string | undefined)[] = [];
  const strategy = defineStrategy({
    name: "recorder",
    needsClassification: "hint",
    async extract(ctx) {
      seen.push(ctx.hints);
      return { data: { invoiceNumber: "INV-1" } };
    },
  });
  return { strategy, seen };
}

describe("direct Contract guidance", () => {
  it.each([
    ["no classifier", undefined, "UNKNOWN", 0, 100],
    ["an UNKNOWN verdict", "UNKNOWN", "UNKNOWN", 1, 200],
    ["a receipt verdict", "receipt", "receipt", 1, 200],
  ] as const)("sends a hinted Contract's guidance instead of a sole unrelated candidate's with %s", async (_label, verdict, classified, classifierCalls, inputTokens) => {
    const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
    const classification = mockModel([{ name: verdict, confidence: 0.9, reason: "Header" }]);
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [llm({ model: extraction.model })],
      classifiers: verdict === undefined ? [] : [new LlmClassifier({ model: classification.model })],
      classifications: [receipt],
    });
    const result = await extractor.extract(BYTES, hintedInvoice);
    expect(result.data).toEqual({ invoiceNumber: "INV-1" });
    expect(result.classification?.name).toBe(classified);
    expect(classification.calls).toHaveLength(classifierCalls);
    expect(result.usage.inputTokens).toBe(inputTokens);
    const request = JSON.stringify(extraction.calls);
    expect(request).toContain("INVOICE_CONTRACT_HINT");
    expect(request).not.toContain("RECEIPT_ONLY_HINT");
  });

  it.each([
    ["two configured candidates", [receipt, statement], undefined],
    ["caller candidates", [], [receipt, statement]],
    ["explicit empty candidates", [receipt], []],
  ] as const)("sends a hinted Contract's guidance with %s", async (_label, configured, perCall) => {
    const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [llm({ model: extraction.model })],
      classifications: configured,
    });
    const result = await extractor.extract(BYTES, hintedInvoice, perCall === undefined ? {} : { classifications: perCall });
    expect(result.data).toEqual({ invoiceNumber: "INV-1" });
    const request = JSON.stringify(extraction.calls);
    expect(request).toContain("INVOICE_CONTRACT_HINT");
    expect(request).not.toContain("RECEIPT_ONLY_HINT");
    expect(request).not.toContain("STATEMENT_ONLY_HINT");
  });

  it.each([
    ["defined", "INVOICE_CONTRACT_HINT"],
    ["empty", ""],
  ])("sends %s Contract hints over a same-name candidate selected by the classifier", async (_label, hints) => {
    const { strategy, seen } = hintRecorder();
    const configuredInvoice = defineClassification({
      name: "invoice", description: "An invoice", hints: "CONFIGURED_INVOICE_HINT", schema: Invoice,
    });
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [strategy],
      classifiers: [fixedClassifier("invoice")],
      classifications: [configuredInvoice, receipt],
    });
    const result = await extractor.extract(BYTES, contract({ name: "invoice", hints, schema: Invoice }));
    expect(result.classification?.name).toBe("invoice");
    expect(seen).toEqual([hints]);
  });

  const hintless = contract({ name: "invoice", schema: Invoice });
  const sameName = defineClassification({ name: "invoice", description: "An invoice", hints: "STANDBY_INVOICE_HINT", schema: Invoice });
  const silentStatement = defineClassification({ name: "statement", description: "A statement", schema: Invoice });
  const emptyStatement = defineClassification({ name: "statement", description: "A statement", hints: "", schema: Invoice });

  it.each<[string, readonly Classification[], string | null | undefined, string | undefined]>([
    ["an unrelated sole candidate without a classifier", [receipt], undefined, undefined],
    ["an unrelated sole candidate under UNKNOWN", [receipt], null, undefined],
    ["a same-name sole candidate under UNKNOWN", [sameName], null, "STANDBY_INVOICE_HINT"],
    ["a same-name candidate among several under UNKNOWN", [sameName, receipt], null, undefined],
    ["a verdict naming an unrelated candidate", [receipt, statement], "receipt", "RECEIPT_ONLY_HINT"],
    ["a selected candidate without hints", [receipt, silentStatement], "statement", undefined],
    ["a selected candidate with empty hints", [receipt, emptyStatement], "statement", ""],
    ["no configured candidates", [], undefined, undefined],
  ])("resolves a hint-less Contract's guidance from %s", async (_label, classifications, verdict, expected) => {
    const { strategy, seen } = hintRecorder();
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [strategy],
      classifiers: verdict === undefined ? [] : [fixedClassifier(verdict)],
      classifications,
    });
    const result = await extractor.extract(BYTES, hintless);
    expect(result.classification?.name).toBe(verdict ?? "UNKNOWN");
    expect(seen).toEqual([expected]);
  });

  it.each<[string, readonly Classification[], string | null, string | undefined]>([
    ["a sole candidate under UNKNOWN", [receipt], null, "RECEIPT_ONLY_HINT"],
    ["a verdict-named candidate", [receipt, statement], "statement", "STATEMENT_ONLY_HINT"],
    ["two candidates under UNKNOWN", [receipt, statement], null, undefined],
  ])("resolves a bare schema's guidance from %s", async (_label, classifications, verdict, expected) => {
    const { strategy, seen } = hintRecorder();
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [strategy],
      classifiers: [fixedClassifier(verdict)],
      classifications,
    });
    const result = await extractor.extract(BYTES, Invoice);
    expect(result.classification?.name).toBe(verdict ?? "UNKNOWN");
    expect(seen).toEqual([expected]);
  });

  it("sends a hinted Contract's guidance to every document in a batch", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [llm({ model: extraction.model })],
      classifications: [receipt],
    });
    const items = [];
    for await (const item of extractor.extractBatch([BYTES, BYTES], hintedInvoice)) items.push(item);
    expect(items.map((item) => item.outcome.ok)).toEqual([true, true]);
    expect(extraction.calls).toHaveLength(2);
    for (const call of extraction.calls) {
      const request = JSON.stringify(call.prompt);
      expect(request).toContain("INVOICE_CONTRACT_HINT");
      expect(request).not.toContain("RECEIPT_ONLY_HINT");
    }
  });

  it("sends a hinted Contract's guidance to a vision prompt instead of a sole unrelated candidate's", async () => {
    const extraction = mockModel([{ invoiceNumber: "INV-1" }]);
    const rasterizer: Rasterizer = {
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
    const extractor = createExtractor({
      loaders: [withRasterizer(loader(), rasterizer)],
      strategies: [vision({ model: extraction.model })],
      classifications: [receipt],
    });
    const result = await extractor.extract(BYTES, hintedInvoice);
    expect(result.data).toEqual({ invoiceNumber: "INV-1" });
    const request = JSON.stringify(extraction.calls);
    expect(request).toContain("INVOICE_CONTRACT_HINT");
    expect(request).not.toContain("RECEIPT_ONLY_HINT");
  });

  class GetterOptions implements RunOptions {
    #values: Required<RunOptions>;
    constructor(values: Required<RunOptions>) { this.#values = values; }
    get signal() { return this.#values.signal; }
    get pages() { return this.#values.pages; }
    get stageTimeoutMs() { return this.#values.stageTimeoutMs; }
    get only() { return this.#values.only; }
    get classifications() { return this.#values.classifications; }
    get classify() { return this.#values.classify; }
    get logger() { return this.#values.logger; }
    get rules() { return this.#values.rules; }
    get onRuleFailure() { return this.#values.onRuleFailure; }
    get maxRepairs() { return this.#values.maxRepairs; }
  }

  const optionShapes: [string, (values: Required<RunOptions>) => RunOptions][] = [
    ["own properties", (values) => values],
    ["inherited properties", (values) => Object.create(values)],
    ["private-field getters", (values) => new GetterOptions(values)],
    ["non-enumerable own properties", (values) => Object.defineProperties({}, {
      signal: { value: values.signal },
      pages: { value: values.pages },
      stageTimeoutMs: { value: values.stageTimeoutMs },
      only: { value: values.only },
      classifications: { value: values.classifications },
      classify: { value: values.classify },
      logger: { value: values.logger },
      rules: { value: values.rules },
      onRuleFailure: { value: values.onRuleFailure },
      maxRepairs: { value: values.maxRepairs },
    })],
  ];

  function selectionOptions(signal = new AbortController().signal): Required<RunOptions> {
    return {
      signal, pages: [2], stageTimeoutMs: 10_000, only: ["recorder"],
      classifications: [sameName], classify: {}, logger: silentLogger, rules: [], onRuleFailure: "report", maxRepairs: 1,
    };
  }

  it.each(optionShapes)("preserves caller candidates and page selection from %s", async (_label, makeOptions) => {
    const classified: { candidates: string[]; pages: number[] }[] = [];
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["page one", "page two"]))],
      classifications: [receipt],
      classifiers: [{
        name: "fixed",
        async classify(ctx) {
          classified.push({
            candidates: ctx.candidates.map((candidate) => candidate.name),
            pages: ctx.document.pages.map((page) => page.pageNumber),
          });
          return {
            classifier: "fixed", name: ctx.candidates[0]?.name ?? null, confidence: 1,
            usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, wallMs: 0 },
          };
        },
      }],
      strategies: [defineStrategy({
        name: "recorder", needsClassification: "hint",
        async extract(ctx) {
          return {
            data: { invoiceNumber: ctx.document.text },
            usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5, wallMs: 0 },
          };
        },
      })],
    });
    const result = await extractor.extract(BYTES, hintedInvoice, makeOptions(selectionOptions()));
    expect(classified).toEqual([{ candidates: ["invoice"], pages: [2] }]);
    expect(result.data).toEqual({ invoiceNumber: "page two" });
    expect(result.classification?.name).toBe("invoice");
    expect(result.classification?.signals).toHaveLength(1);
    expect(result.usage.totalTokens).toBe(15);
  });

  it.each(optionShapes)("honors an already-aborted caller signal from %s before strategy work", async (_label, makeOptions) => {
    let strategyCalls = 0;
    const extractor = createExtractor({
      loaders: [loader()], classifications: [receipt],
      strategies: [defineStrategy({
        name: "recorder", needsClassification: "none",
        async extract() {
          strategyCalls += 1;
          return { data: { invoiceNumber: "INV-1" } };
        },
      })],
    });
    const signal = AbortSignal.abort(new DOMException("Caller stopped", "AbortError"));
    await expect(extractor.extract(BYTES, hintedInvoice, makeOptions(selectionOptions(signal))))
      .rejects.toMatchObject({ name: "AbortError", message: "Caller stopped" });
    expect(strategyCalls).toBe(0);
  });

  it("uses getter-based strategy, logger, deadline and classification overrides", async () => {
    vi.useFakeTimers();
    try {
      const messages: string[] = [];
      const deadlines: ({ stage: string; ms: number } | null)[] = [];
      const selected: unknown[] = [];
      const logger: Logger = {
        ...silentLogger,
        info(message) { messages.push(message); },
        child() { return logger; },
      };
      const extractor = createExtractor({
        loaders: [inMemoryLoader(loadedDocument(["page one", "page two"]))],
        classifications: [receipt], classifiers: [{
          name: "fixed",
          async classify() { return { classifier: "fixed", name: "invoice", confidence: 0.8 }; },
        }],
        strategies: [
          defineStrategy({ name: "default", async extract() { return { data: { invoiceNumber: "default" } }; } }),
          defineStrategy({
            name: "recorder", needsClassification: "hint",
            async extract(ctx) {
              selected.push({ text: ctx.document.text, classification: ctx.classification });
              await new Promise<void>((resolve) => setTimeout(resolve, 20));
              const reason: unknown = ctx.signal.reason;
              deadlines.push(reason instanceof TimeoutError ? { stage: reason.stage, ms: reason.ms } : null);
              ctx.logger.info("selected strategy");
              return { data: { invoiceNumber: ctx.document.text } };
            },
          }),
        ],
      });
      const options = new GetterOptions({
        ...selectionOptions(), stageTimeoutMs: 10, classify: { threshold: 0.9 }, logger,
      });
      const pending = extractor.safeExtract(BYTES, hintedInvoice, options);
      await vi.advanceTimersByTimeAsync(20);
      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatchObject({
        code: "EXTRACTION_FAILED", attempts: [{ strategy: "recorder", errorCode: "TIMEOUT" }],
      });
      expect(selected).toEqual([{ text: "page two", classification: {
        name: "UNKNOWN", confidence: 0,
        signals: [{ classifier: "fixed", name: "invoice", confidence: 0.8 }],
      } }]);
      expect(messages).toEqual(["selected strategy"]);
      expect(deadlines).toEqual([{ stage: "extract:recorder", ms: 10 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps concurrent Contract guidance separate with shared frozen caller options", async () => {
    const options = Object.freeze(new GetterOptions(selectionOptions()));
    const prototype = Object.getPrototypeOf(options);
    const properties = Object.getOwnPropertyDescriptors(options);
    const extractor = createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["page one", "page two"]))],
      classifications: [receipt],
      strategies: [defineStrategy({
        name: "recorder", needsClassification: "hint",
        async extract(ctx) {
          await Promise.resolve();
          return { data: { invoiceNumber: `${ctx.document.text}: ${ctx.hints}` } };
        },
      })],
    });
    const results = await Promise.all([
      extractor.extract(BYTES, contract({ name: "invoice", schema: Invoice, hints: "LEFT_HINT" }), options),
      extractor.extract(BYTES, contract({ name: "invoice", schema: Invoice, hints: "RIGHT_HINT" }), options),
    ]);
    expect(results.map((result) => result.data)).toEqual([
      { invoiceNumber: "page two: LEFT_HINT" }, { invoiceNumber: "page two: RIGHT_HINT" },
    ]);
    expect(Object.getPrototypeOf(options)).toBe(prototype);
    expect(Object.getOwnPropertyDescriptors(options)).toEqual(properties);
    expect(Object.isFrozen(options)).toBe(true);
    expect(options.pages).toEqual([2]);
    expect(options.classifications).toEqual([sameName]);
  });

  it.each<[string, string, string | undefined]>([
    ["undefined", "inherited", undefined],
    ["empty", "inherited", ""],
    ["undefined", "non-enumerable", undefined],
    ["empty", "non-enumerable", ""],
  ])("keeps %s Process guidance authoritative from %s selection metadata", async (_label, shape, hints) => {
    const processKey = Symbol.for("docture.internal.process-hints.v1");
    const selection = hints === undefined ? {} : { hints };
    const options: RunOptions = Object.freeze(shape === "inherited"
      ? Object.create({ [processKey]: selection })
      : Object.defineProperty({}, processKey, { value: selection }));
    const { strategy, seen } = hintRecorder();
    const extractor = createExtractor({
      loaders: [loader()], strategies: [strategy], classifications: [receipt],
      classifiers: [fixedClassifier("receipt")],
    });
    const result = await extractor.extract(BYTES, hintedInvoice, options);
    expect(result.data).toEqual({ invoiceNumber: "INV-1" });
    expect(result.classification?.name).toBe("receipt");
    expect(seen).toEqual([hints]);
  });
});
