import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DocumentConverter,
  Extractor,
  Process,
  SplittingStrategy,
  defineClassification,
  declarationOrder,
  isDoctureError,
  runPipeline,
  silentLogger,
  type DocumentLoader,
  type LayoutAnalyzer,
} from "../../src/core/index.js";
import { doc, fakeLoader, multiPageDoc, PDF_BYTES } from "./fakes.js";

const schema = z.object({ value: z.string() });
const never = <T>(): Promise<T> => new Promise<T>(() => {});
const stillRunning = (ms: number): Promise<string> =>
  new Promise((resolve) => setTimeout(() => resolve("still running"), ms));
const pdf = { bytes: PDF_BYTES, mimeType: "application/pdf" };

function timeoutOf(error: unknown) {
  return isDoctureError(error, "TIMEOUT")
    ? { stage: error.stage, ms: error.ms, message: error.message, hint: error.hint }
    : error;
}

const CALL_TIMEOUT = {
  stage: "call",
  ms: 30,
  message: '"call" exceeded its 30ms deadline.',
  hint: "The whole call exceeded its timeoutMs deadline. Raise timeoutMs, or omit it for no call deadline.",
};

describe("deadlines beyond the longest timer", () => {
  const slowLoader: DocumentLoader = {
    ...fakeLoader(),
    async load() { await stillRunning(20); return doc("Invoice"); },
  };
  const slowStrategy = { name: "slow", async extract() { await stillRunning(20); return { data: { value: "ok" } }; } };

  it("lets a call finish under a timeoutMs above 2147483647 ms", async () => {
    const extractor = new Extractor({ loaders: [fakeLoader()], strategies: [slowStrategy] });
    const result = await extractor.extract(pdf, schema, { timeoutMs: 3_000_000_000 });
    expect(result.data).toEqual({ value: "ok" });
  });

  it("lets every stage finish under a stageTimeoutMs above 2147483647 ms", async () => {
    const extractor = new Extractor({ loaders: [slowLoader], strategies: [slowStrategy] });
    const result = await extractor.extract(pdf, schema, { stageTimeoutMs: 3_000_000_000 });
    expect({ data: result.data, attempts: result.attempts.map((attempt) => [attempt.stage, attempt.status]) })
      .toEqual({ data: { value: "ok" }, attempts: [["extract", "ok"]] });
  });

  it("lets a conversion finish under deadlines above 2147483647 ms", async () => {
    const converter = new DocumentConverter({ loaders: [slowLoader] });
    const result = await converter.convert(pdf, { timeoutMs: 3_000_000_000, stageTimeoutMs: 3_000_000_000 });
    expect(result.content).toBe("<!-- page: 1 -->\n\nInvoice");
  });
});

describe("timeoutMs bounds a whole extraction call", () => {
  it.each([undefined, 60_000])("reports a timeout without event-loop handles and releases the %s ms stage deadline", (stageTimeoutMs) => {
    const require = createRequire(new URL("../../../../apps/docs/package.json", import.meta.url));
    const entry = new URL("../../src/core/index.ts", import.meta.url).href;
    const script = `
      import { Extractor } from ${JSON.stringify(entry)};
      const extractor = new Extractor({
        loaders: [{ name: "pending", capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] }, load: () => new Promise(() => {}) }],
      });
      try {
        await extractor.classify(new Uint8Array([1]), [], { timeoutMs: 20, stageTimeoutMs: ${stageTimeoutMs} });
      } catch (error) {
        console.log(error.code, error.stage);
      }
    `;
    const child = spawnSync(process.execPath, ["--import", require.resolve("tsx/esm"), "--input-type=module", "-e", script], {
      encoding: "utf8", timeout: 5000,
    });
    expect({ status: child.status, output: child.stdout.trim() }).toEqual({ status: 0, output: "TIMEOUT call" });
  });

  it("bounds calls through the public runPipeline entry point", async () => {
    const outcome = await Promise.race([
      runPipeline({
        loaders: [fakeLoader()],
        strategies: [{ name: "pending", extract: never }],
        classifiers: [], classifications: [], policy: declarationOrder, logger: silentLogger,
      }, pdf, schema, { timeoutMs: 30 }).catch((error: unknown) => error),
      stillRunning(500),
    ]);
    expect(timeoutOf(outcome)).toEqual(CALL_TIMEOUT);
  });

  it("rejects with TIMEOUT at stage call and aborts the component's signal", async () => {
    let seen: AbortSignal | undefined;
    const extractor = new Extractor({
      loaders: [fakeLoader()],
      strategies: [{ name: "deaf", extract: (ctx) => { seen = ctx.signal; return never(); } }],
    });
    const outcome = await Promise.race([
      extractor.extract(pdf, schema, { timeoutMs: 30 }).catch((error: unknown) => error),
      stillRunning(500),
    ]);
    expect(timeoutOf(outcome)).toEqual(CALL_TIMEOUT);
    expect({ aborted: seen?.aborted, reason: seen?.reason }).toEqual({ aborted: true, reason: outcome });
  });

  it("does not fall back once the call deadline passed", async () => {
    let fallbackRuns = 0;
    const extractor = new Extractor({
      loaders: [fakeLoader()],
      strategies: [
        { name: "slow", extract: (ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason))) },
        { name: "fallback", async extract() { fallbackRuns += 1; return { data: { value: "late" } }; } },
      ],
    });
    expect(timeoutOf(await extractor.extract(pdf, schema, { timeoutMs: 30 }).catch((error: unknown) => error))).toEqual(CALL_TIMEOUT);
    expect(fallbackRuns).toBe(0);
  });

  it("keeps a caller abort as the rejection reason", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const extractor = new Extractor({ loaders: [fakeLoader({ hang: true })] });
    setTimeout(() => controller.abort(reason), 5);
    await expect(extractor.extract(pdf, schema, { timeoutMs: 1_000, signal: controller.signal })).rejects.toBe(reason);
  });

  it("uses the extractor's default and lets a call override it", async () => {
    const extractor = new Extractor({ loaders: [fakeLoader({ hang: true })], timeoutMs: 30 });
    expect(timeoutOf(await extractor.extractData(pdf, schema).catch((error: unknown) => error))).toEqual(CALL_TIMEOUT);
    expect(timeoutOf(await extractor.safeExtract(pdf, schema, { timeoutMs: 40 }).then((outcome) => outcome.ok ? outcome : outcome.error)))
      .toMatchObject({ stage: "call", ms: 40 });
  });

  it("bounds classify and classifyTree", async () => {
    const extractor = new Extractor({ loaders: [fakeLoader()], classifiers: [{ name: "deaf", classify: never }] });
    const kinds = [defineClassification({ name: "invoice", description: "an invoice", schema })];
    expect(timeoutOf(await extractor.classify(pdf, kinds, { timeoutMs: 30 }).catch((error: unknown) => error))).toEqual(CALL_TIMEOUT);
    const tree = { nodes: [{ classification: kinds[0]! }] };
    expect(timeoutOf(await extractor.classifyTree(pdf, tree, { timeoutMs: 30 }).catch((error: unknown) => error))).toEqual(CALL_TIMEOUT);
  });

  it("gives each batch item its own deadline", async () => {
    const slowFor = (text: string): DocumentLoader => ({
      name: "by-name",
      capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
      async load(raw) {
        if (raw.fileName === "slow.pdf") return never();
        return doc(text);
      },
    });
    const extractor = new Extractor({
      loaders: [slowFor("Invoice total")],
      strategies: [{ name: "echo", async extract() { return { data: { value: "ok" } }; } }],
    });
    const outcomes: unknown[] = [];
    for await (const item of extractor.extractBatch(
      [{ ...pdf, fileName: "slow.pdf" }, { ...pdf, fileName: "fast.pdf" }],
      schema,
      { timeoutMs: 30 },
    )) {
      outcomes[item.index] = item.outcome.ok ? item.outcome.result.data : timeoutOf(item.outcome.error);
    }
    expect(outcomes).toEqual([CALL_TIMEOUT, { value: "ok" }]);
  });

  it("rejects a timeoutMs that is not a positive finite number", async () => {
    const extractor = new Extractor({ loaders: [fakeLoader()] });
    await expect(extractor.extract(pdf, schema, { timeoutMs: 0 })).rejects.toMatchObject({
      code: "INVALID_OPTION", message: "timeoutMs must be a finite positive number; received 0.",
    });
    expect(() => new Extractor({ timeoutMs: -1 })).toThrow(expect.objectContaining({ code: "INVALID_OPTION", option: "timeoutMs" }));
  });
});

describe("timeoutMs bounds a whole conversion call", () => {
  it("rejects with TIMEOUT at stage call when a loader never settles", async () => {
    const converter = new DocumentConverter({ loaders: [{ ...fakeLoader(), load: never }] });
    const outcome = await Promise.race([
      converter.convert(pdf, { timeoutMs: 30 }).catch((error: unknown) => error),
      stillRunning(500),
    ]);
    expect(timeoutOf(outcome)).toEqual(CALL_TIMEOUT);
    expect(timeoutOf(await new DocumentConverter({ loaders: [fakeLoader({ hang: true })], timeoutMs: 30 })
      .safeConvert(pdf).then((outcome) => outcome.ok ? outcome : outcome.error))).toEqual(CALL_TIMEOUT);
  });

  it("abandons a layout analyzer that outlives its stage deadline", async () => {
    const analyzer: LayoutAnalyzer = { name: "deaf", analyze: never };
    const converter = new DocumentConverter({ loaders: [fakeLoader()], layoutAnalyzer: analyzer, stageTimeoutMs: 20 });
    const outcome = await Promise.race([
      converter.convert(pdf).then((result) => ({
        method: result.method,
        attempts: result.attempts.map((attempt) => [attempt.stage, attempt.strategy, attempt.status, attempt.errorCode]),
      })),
      stillRunning(500),
    ]);
    expect(outcome).toEqual({
      method: "deterministic",
      attempts: [["load", "fake", "ok", undefined], ["layout", "deaf", "failed", "TIMEOUT"]],
    });
  });
});

describe("timeoutMs bounds a whole Process call", () => {
  it("rejects a split that resolves successfully in response to the expired deadline", async () => {
    const invoice = defineClassification({ name: "invoice", description: "an invoice", schema });
    const process = new Process()
      .loadSplitter({
        name: "late",
        belongsToSameDocument: never,
        splitEager: (pages, ctx) => new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve([
            { pages: pages.map((page) => page.pageNumber), classification: "invoice" },
          ]), { once: true });
        }),
      })
      .split([invoice]);
    await expect(process.splitOnly({ loaded: multiPageDoc(["a", "b"]) }, { timeoutMs: 30 }))
      .rejects.toMatchObject({ code: "TIMEOUT", stage: "call", ms: 30 });
    expect(process.lastSplit).toBeUndefined();
  });

  it("rejects with TIMEOUT at stage call when the splitter never settles", async () => {
    const invoice = defineClassification({ name: "invoice", description: "an invoice", schema });
    const process = new Process()
      .loadExtractor(new Extractor({ loaders: [fakeLoader({ document: multiPageDoc(["a", "b"]) })] }))
      .loadSplitter({ name: "deaf", belongsToSameDocument: never })
      .split([invoice], SplittingStrategy.LAZY);
    const outcome = await Promise.race([
      process.extract(pdf, { timeoutMs: 30 }).catch((error: unknown) => error),
      stillRunning(500),
    ]);
    expect(timeoutOf(outcome)).toEqual(CALL_TIMEOUT);
    expect(timeoutOf(await process.splitOnly(pdf, { timeoutMs: 30 }).catch((error: unknown) => error))).toEqual(CALL_TIMEOUT);
  });
});
