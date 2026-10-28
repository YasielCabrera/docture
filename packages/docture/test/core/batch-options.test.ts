import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  contract,
  createExtractor,
  DocumentConverter,
  Extractor,
  silentLogger,
  TimeoutError,
  type ContractLike,
  type ConvertOptions,
  type DocumentSource,
  type Logger,
  type RunOptions,
} from "docture";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";

const schema = z.object({ text: z.string() });
const invoice = { name: "invoice", description: "An invoice", hints: "CANDIDATE_HINT", schema };
const receipt = { name: "receipt", description: "A receipt", hints: "RECEIPT_HINT", schema };
const invoiceContract = contract({ name: "invoice", schema, hints: "CONTRACT_HINT" });
const source = { loaded: loadedDocument(["page one", "page two"]) };
const bytes = new Uint8Array([1]);
const processKey = Symbol.for("docture.internal.process-hints.v1");

type OptionShape = "own properties" | "inherited properties" | "private-field getters" | "non-enumerable properties";
const optionShapes: readonly OptionShape[] = [
  "own properties", "inherited properties", "private-field getters", "non-enumerable properties",
];

class GetterRunOptions {
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

class GetterConvertOptions {
  #values: Required<ConvertOptions>;
  constructor(values: Required<ConvertOptions>) { this.#values = values; }
  get format() { return this.#values.format; }
  get pages() { return this.#values.pages; }
  get assets() { return this.#values.assets; }
  get signal() { return this.#values.signal; }
  get logger() { return this.#values.logger; }
  get stageTimeoutMs() { return this.#values.stageTimeoutMs; }
}

function nonEnumerable<T extends object>(values: T): T {
  for (const key of Reflect.ownKeys(values)) Object.defineProperty(values, key, { enumerable: false });
  return values;
}

function runOptions(shape: OptionShape, values: Required<RunOptions>): RunOptions {
  switch (shape) {
    case "own properties": return values;
    case "private-field getters": return new GetterRunOptions(values);
    case "non-enumerable properties": return nonEnumerable(values);
    case "inherited properties": {
      const options: RunOptions = {};
      Object.setPrototypeOf(options, values);
      return options;
    }
  }
}

function convertOptions(shape: OptionShape, values: Required<ConvertOptions>): ConvertOptions {
  switch (shape) {
    case "own properties": return values;
    case "private-field getters": return new GetterConvertOptions(values);
    case "non-enumerable properties": return nonEnumerable(values);
    case "inherited properties": {
      const options: ConvertOptions = {};
      Object.setPrototypeOf(options, values);
      return options;
    }
  }
}

function runValues(overrides: RunOptions = {}): Required<RunOptions> {
  return {
    signal: new AbortController().signal, pages: [2], stageTimeoutMs: 10_000,
    only: ["recorder"], classifications: [invoice], classify: { threshold: 0.5 },
    logger: silentLogger, rules: [], onRuleFailure: "report", maxRepairs: 1, ...overrides,
  };
}

function convertValues(overrides: ConvertOptions = {}): Required<ConvertOptions> {
  return {
    format: "html", pages: [1], assets: "embedded", signal: new AbortController().signal,
    logger: silentLogger, stageTimeoutMs: 10_000, ...overrides,
  };
}

function recordingLogger(messages: string[]): Logger {
  const logger: Logger = {
    ...silentLogger,
    info(message) { messages.push(message); },
    child() { return logger; },
  };
  return logger;
}

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

const imageSource: DocumentSource = {
  loaded: {
    ...loadedDocument(["Chart caption"]),
    pages: [{
      pageNumber: 1, width: 595, height: 842, text: "Chart caption",
      blocks: [{ id: "figure", kind: "image", assetId: "chart", x: 20, y: 40, width: 40, height: 30, alt: "chart" }],
      assets: [{ id: "chart", pageNumber: 1, name: "chart.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]), x: 20, y: 40, width: 40, height: 30 }],
    }],
  },
};

describe("batch option preservation", () => {
  for (const shape of optionShapes) {
    for (const target of ["bare schema", "Contract"]) {
      it(`extracts selected pages with caller candidates, strategy, classification settings and logger from ${shape} for a ${target}`, async () => {
        const messages: string[] = [];
        const classified: { candidates: string[]; pages: number[] }[] = [];
        const extractor = createExtractor({
          loaders: [inMemoryLoader(source.loaded)], classifications: [receipt], classify: { threshold: 0.99 },
          classifiers: [{
            name: "fixed",
            async classify(ctx) {
              classified.push({ candidates: ctx.candidates.map((candidate) => candidate.name), pages: ctx.document.pages.map((page) => page.pageNumber) });
              return { classifier: "fixed", name: ctx.candidates[0]?.name ?? null, confidence: 0.8, usage: { totalTokens: 7 } };
            },
          }],
          strategies: [
            { name: "default", async extract() { return { data: { text: "default" } }; } },
            {
              name: "recorder", needsClassification: "hint",
              async extract(ctx) {
                ctx.logger.info("selected strategy");
                return { data: { text: ctx.document.text }, usage: { totalTokens: 5 } };
              },
            },
          ],
        });
        const options = Object.freeze(runOptions(shape, runValues({ logger: recordingLogger(messages) })));
        const properties = Object.getOwnPropertyDescriptors(options);
        const prototype = Object.getPrototypeOf(options);
        const items = [];
        for await (const item of extractor.extractBatch([source], target === "Contract" ? invoiceContract : schema, options)) items.push(item);
        expect(classified).toEqual([{ candidates: ["invoice"], pages: [2] }]);
        expect(items).toHaveLength(1);
        expect(items[0]?.outcome).toMatchObject({
          ok: true,
          result: {
            data: { text: "page two" },
            method: "recorder", classification: { name: "invoice", confidence: 0.8, signals: [{ classifier: "fixed", name: "invoice", confidence: 0.8, usage: { totalTokens: 7 } }] },
            usage: { totalTokens: 12 },
          },
        });
        expect(messages).toEqual(["selected strategy"]);
        expect(options.signal?.aborted).toBe(false);
        expect(Object.getOwnPropertyDescriptors(options)).toEqual(properties);
        expect(Object.getPrototypeOf(options)).toBe(prototype);
        expect(Object.isFrozen(options)).toBe(true);
      });
    }

    it(`converts to HTML with embedded assets and the caller logger from ${shape}`, async () => {
      const messages: string[] = [];
      const converter = new DocumentConverter({
        layoutAnalyzer: { name: "recorder", async analyze(ctx) { ctx.logger.info("selected analyzer"); return { annotations: [] }; } },
      });
      const options = Object.freeze(convertOptions(shape, convertValues({ logger: recordingLogger(messages) })));
      const properties = Object.getOwnPropertyDescriptors(options);
      const prototype = Object.getPrototypeOf(options);
      const items = [];
      for await (const item of converter.convertBatch([imageSource], options)) items.push(item);
      expect(items[0]?.outcome).toMatchObject({ ok: true, result: { format: "html", mimeType: "text/html" } });
      const outcome = items[0]?.outcome;
      if (outcome?.ok !== true) throw new Error("Expected successful conversion");
      expect(outcome.result.content).toContain('<img src="data:image/png;base64,iVBORw==" alt="chart">');
      expect(outcome.result.assets).toHaveLength(1);
      expect(messages).toEqual(["selected analyzer"]);
      expect(options.signal?.aborted).toBe(false);
      expect(Object.getOwnPropertyDescriptors(options)).toEqual(properties);
      expect(Object.getPrototypeOf(options)).toBe(prototype);
      expect(Object.isFrozen(options)).toBe(true);
    });

    for (const operation of ["extract", "convert"]) {
      it(`${operation} batch honors a stage deadline from ${shape}`, async () => {
        vi.useFakeTimers();
        const started = deferred();
        const finish = deferred();
        const deadlines: { stage: string; ms: number }[] = [];
        const work = async (signal: AbortSignal) => {
          started.release();
          await finish.promise;
          const reason: unknown = signal.reason;
          if (reason instanceof TimeoutError) deadlines.push({ stage: reason.stage, ms: reason.ms });
        };
        try {
          const batch = operation === "extract"
            ? createExtractor({
              loaders: [inMemoryLoader(source.loaded)],
              strategies: [{ name: "recorder", async extract(ctx) { await work(ctx.signal); return { data: { text: "finished" } }; } }],
            }).extractBatch([source], invoiceContract, Object.freeze(runOptions(shape, runValues({ stageTimeoutMs: 10 }))))
            : new DocumentConverter({
              layoutAnalyzer: { name: "recorder", async analyze(ctx) { await work(ctx.signal); return { annotations: [] }; } },
            }).convertBatch([source], Object.freeze(convertOptions(shape, convertValues({ stageTimeoutMs: 10 }))));
          const pending = batch.next();
          await started.promise;
          await vi.advanceTimersByTimeAsync(10);
          finish.release();
          const item = (await pending).value;
          expect(item?.outcome.ok).toBe(operation === "convert");
          if (item !== undefined && !item.outcome.ok) {
            expect(item.outcome.error).toMatchObject({
              code: "EXTRACTION_FAILED", attempts: [{ stage: "extract", errorCode: "TIMEOUT" }],
            });
          }
          await batch.return();
          expect(deadlines).toEqual([{ stage: `${operation === "extract" ? "extract" : "layout"}:recorder`, ms: 10 }]);
        } finally {
          finish.release();
          vi.useRealTimers();
        }
      });

      it(`${operation} batch honors a pre-aborted caller signal from ${shape} before component work`, async () => {
        let calls = 0;
        const signal = AbortSignal.abort(new DOMException("Caller stopped", "AbortError"));
        const batch = operation === "extract"
          ? createExtractor({
            loaders: [inMemoryLoader(source.loaded)],
            strategies: [{ name: "recorder", async extract() { calls += 1; return { data: { text: "unexpected" } }; } }],
          }).extractBatch([bytes], invoiceContract, Object.freeze(runOptions(shape, runValues({ signal }))))
          : new DocumentConverter({
            loaders: [inMemoryLoader(source.loaded)],
            layoutAnalyzer: { name: "recorder", async analyze() { calls += 1; return { annotations: [] }; } },
          }).convertBatch([bytes], Object.freeze(convertOptions(shape, convertValues({ signal }))));
        const items = [];
        for await (const item of batch) items.push(item);
        expect(items).toHaveLength(1);
        expect(items[0]?.outcome).toMatchObject({ ok: false, error: { name: "AbortError", message: "Caller stopped" } });
        expect(calls).toBe(0);
        expect(signal.aborted).toBe(true);
      });
    }
  }

  for (const operation of ["extract", "convert"]) {
    it(`${operation} batch reads a changing caller signal getter once on its original receiver`, async () => {
      const stopped = AbortSignal.abort(new DOMException("First signal stopped", "AbortError"));
      class Options {
        #reads = 0;
        get reads() { return this.#reads; }
        get signal() { this.#reads += 1; return this.#reads === 1 ? stopped : new AbortController().signal; }
      }
      const options = Object.freeze(new Options());
      const batch = operation === "extract"
        ? createExtractor({ loaders: [inMemoryLoader(source.loaded)], strategies: [{ name: "recorder", async extract() { return { data: { text: "unexpected" } }; } }] }).extractBatch([source], schema, options)
        : new DocumentConverter({ loaders: [inMemoryLoader(source.loaded)] }).convertBatch([bytes], options);
      const items = [];
      for await (const item of batch) items.push(item);
      expect(items[0]?.outcome).toMatchObject({ ok: false, error: { name: "AbortError", message: "First signal stopped" } });
      expect(options.reads).toBe(1);
    });
  }

  it("uses the snapshotted caller candidates when a Contract classifications getter changes", async () => {
    class Options {
      #reads = 0;
      get reads() { return this.#reads; }
      get classifications() { this.#reads += 1; return this.#reads === 1 ? [invoice] : [receipt]; }
    }
    const options = Object.freeze(new Options());
    const candidates: string[][] = [];
    const extractor = createExtractor({
      loaders: [inMemoryLoader(source.loaded)],
      classifiers: [{ name: "fixed", async classify(ctx) { candidates.push(ctx.candidates.map((candidate) => candidate.name)); return { classifier: "fixed", name: "invoice", confidence: 1 }; } }],
      strategies: [{ name: "recorder", needsClassification: "hint", async extract() { return { data: { text: "selected" } }; } }],
    });
    const result = await extractor.extract(source, contract({ name: "document", schema }), options);
    expect(result.data).toEqual({ text: "selected" });
    expect(result.classification?.name).toBe("invoice");
    expect(candidates).toEqual([["invoice"]]);
    expect(options.reads).toBe(1);
  });

  it("forwards unknown own enumerable strings and symbols to extraction batch jobs", async () => {
    const extraKey = Symbol("caller extra");
    const extras: unknown[] = [];
    class ForwardingExtractor extends Extractor {
      override safeExtract<C extends ContractLike>(source: DocumentSource, contract: C, options?: RunOptions) {
        if (options !== undefined && "custom" in options && extraKey in options) extras.push([options.custom, options[extraKey]]);
        return super.safeExtract(source, contract, options);
      }
    }
    const extractor = new ForwardingExtractor({
      loaders: [inMemoryLoader(source.loaded)], strategies: [{ name: "recorder", async extract(ctx) { return { data: { text: ctx.document.text } }; } }],
    });
    const options = Object.freeze({ ...runValues(), custom: "caller value", [extraKey]: "symbol value" });
    const items = [];
    for await (const item of extractor.extractBatch([source, source], schema, options)) items.push(item);
    expect(items.map((item) => item.outcome)).toMatchObject([
      { ok: true, result: { data: { text: "page two" } } }, { ok: true, result: { data: { text: "page two" } } },
    ]);
    expect(extras).toEqual([["caller value", "symbol value"], ["caller value", "symbol value"]]);
    expect(options.signal.aborted).toBe(false);
  });

  it("forwards unknown own enumerable strings and symbols to conversion batch jobs", async () => {
    const extraKey = Symbol("caller extra");
    const extras: unknown[] = [];
    class ForwardingConverter extends DocumentConverter {
      override safeConvert(source: DocumentSource, options?: ConvertOptions) {
        if (options !== undefined && "custom" in options && extraKey in options) extras.push([options.custom, options[extraKey]]);
        return super.safeConvert(source, options);
      }
    }
    const converter = new ForwardingConverter();
    const options = Object.freeze({ ...convertValues(), custom: "caller value", [extraKey]: "symbol value" });
    const items = [];
    for await (const item of converter.convertBatch([source, source], options)) items.push(item);
    expect(items.map((item) => item.outcome)).toMatchObject([
      { ok: true, result: { format: "html" } }, { ok: true, result: { format: "html" } },
    ]);
    expect(extras).toEqual([["caller value", "symbol value"], ["caller value", "symbol value"]]);
    expect(options.signal.aborted).toBe(false);
  });

  for (const shape of optionShapes) {
    for (const hints of ["PROCESS_HINT", "", undefined]) {
      it(`keeps ${hints === undefined ? "absent" : hints === "" ? "empty" : "defined"} Process guidance authoritative in a batch from ${shape}`, async () => {
        const selection = hints === undefined ? {} : { hints };
        class SelectionOptions {
          #selection = selection;
          get [processKey]() { return this.#selection; }
          get logger() { return silentLogger; }
        }
        let options: RunOptions = {};
        switch (shape) {
          case "own properties": Object.assign(options, { [processKey]: selection }); break;
          case "inherited properties": Object.setPrototypeOf(options, { [processKey]: selection }); break;
          case "private-field getters": options = new SelectionOptions(); break;
          case "non-enumerable properties": Object.defineProperty(options, processKey, { value: selection }); break;
        }
        options = Object.freeze(options);
        const properties = Object.getOwnPropertyDescriptors(options);
        const extractor = createExtractor({
          loaders: [inMemoryLoader(source.loaded)], classifications: [receipt],
          strategies: [{ name: "recorder", async extract(ctx) { return { data: { text: String(ctx.hints) } }; } }],
        });
        const items = [];
        for await (const item of extractor.extractBatch([source], invoiceContract, options)) items.push(item);
        expect(items[0]?.outcome).toMatchObject({ ok: true, result: { data: { text: String(hints) } } });
        expect(Object.getOwnPropertyDescriptors(options)).toEqual(properties);
      });
    }
  }
});
