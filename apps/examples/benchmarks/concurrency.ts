import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism, cpus, freemem, loadavg, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { contract, silentLogger, withRasterizer, type ConversionResult, type DocumentSource } from "docture";
import { createExtractor, DocumentConverter } from "docture/node";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { DocumentLoaderTesseract } from "docture/loaders/tesseract";
import { DocumentLoaderPaddleOcr } from "docture/loaders/paddleocr";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import { makeInvoicePdf } from "docture/testing/fixtures";

interface Sample {
  readonly coldMs: number;
  readonly warmMs: number;
  readonly warmCpuMs: number;
  /** Units the warm pass completed. */
  readonly units: number;
  /** Units each pass was meant to complete. */
  readonly expected: number;
  readonly maxRssMB: number;
  readonly errors: number;
  readonly detail: string;
}

interface Scenario {
  readonly group: "model" | "ocr" | "raster";
  readonly name: string;
  readonly unit: string;
  readonly variants: readonly string[];
  readonly describe: string;
  run(variant: string, latencyMs: number): Promise<Omit<Sample, "maxRssMB">>;
}

const Fields = contract({
  name: "fields",
  description: "Benchmark fields.",
  schema: z.object({ invoiceNumber: z.string(), total: z.number() }),
});

function mockModel(latencyMs: number) {
  let requests = 0;
  const model = new MockLanguageModelV4({
    modelId: "mock-fixed-latency",
    provider: "mock",
    async doGenerate(options) {
      requests += 1;
      await sleep(latencyMs, undefined, options.abortSignal === undefined ? {} : { signal: options.abortSignal });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ invoiceNumber: "MOCK-1", total: 1 }) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, requests: () => requests };
}

/** Intended units missing from either pass, plus failed checks. */
const shortfall = (expected: number, cold: number, warm: number): number => 2 * expected - cold - warm;

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; cpuMs: number; value: T }> {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const value = await work();
  const used = process.cpuUsage(cpu);
  return { ms: performance.now() - started, cpuMs: (used.user + used.system) / 1000, value };
}

const concurrencyOf = (variant: string): number | undefined =>
  variant === "default" ? undefined : Number(variant.replace(/^c/, ""));

const BATCH_DOCUMENTS = 8;
const LONG_LINE_ITEMS = 300;
const OCR_LINE_ITEMS = 150;

const scenarios: readonly Scenario[] = [
  {
    group: "model",
    name: "batch",
    unit: "docs",
    variants: ["c1", "default"],
    describe: `extractBatch, ${BATCH_DOCUMENTS} one-page PDFs, pdfjs, llm() one request per document`,
    async run(variant, latencyMs) {
      const sources = await Promise.all(Array.from({ length: BATCH_DOCUMENTS }, async (_, i) =>
        (await makeInvoicePdf({ seed: i + 1, lineItemCount: 6 })).bytes));
      const mock = mockModel(latencyMs);
      const extractor = createExtractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [llm({ model: mock.model, maxRetries: 0 })] });
      const concurrency = concurrencyOf(variant);
      const pass = async () => {
        let completed = 0;
        for await (const item of extractor.extractBatch(sources.map((bytes) => bytes.slice()), Fields, concurrency === undefined ? {} : { concurrency })) {
          if (item.outcome.ok && item.outcome.result.data.invoiceNumber === "MOCK-1") completed += 1;
        }
        return completed;
      };
      try {
        const cold = await timed(pass);
        const warm = await timed(pass);
        return {
          coldMs: cold.ms, warmMs: warm.ms, warmCpuMs: warm.cpuMs, units: warm.value, expected: sources.length,
          errors: shortfall(sources.length, cold.value, warm.value), detail: `${mock.requests()} requests`,
        };
      } finally {
        await extractor.dispose();
      }
    },
  },
  {
    group: "model",
    name: "text chunks",
    unit: "pages",
    variants: ["c1", "default"],
    describe: "one long PDF, pdfjs, llm({ completion: \"paginate\" }) one request per page",
    async run(variant, latencyMs) {
      const document = await makeInvoicePdf({ seed: 11, lineItemCount: LONG_LINE_ITEMS });
      const mock = mockModel(latencyMs);
      const concurrency = concurrencyOf(variant);
      const extractor = createExtractor({
        loaders: [new DocumentLoaderPdfJs()],
        strategies: [llm({ model: mock.model, completion: "paginate", maxRetries: 0, ...(concurrency === undefined ? {} : { concurrency }) })],
      });
      const pass = async () => {
        const before = mock.requests();
        const result = await extractor.extract(document.bytes.slice(), Fields);
        return result.data.invoiceNumber === "MOCK-1" ? mock.requests() - before : 0;
      };
      try {
        const cold = await timed(pass);
        const warm = await timed(pass);
        return {
          coldMs: cold.ms, warmMs: warm.ms, warmCpuMs: warm.cpuMs, units: warm.value, expected: document.pageCount,
          errors: shortfall(document.pageCount, cold.value, warm.value), detail: `${mock.requests()} requests`,
        };
      } finally {
        await extractor.dispose();
      }
    },
  },
  {
    group: "model",
    name: "vision pages",
    unit: "pages",
    variants: ["c1", "default"],
    describe: "one long PDF, pdfjs + napi-canvas, vision({ pageMode: \"perPage\" }) at its 200 DPI, maxEdge 1568 default",
    async run(variant, latencyMs) {
      const document = await makeInvoicePdf({ seed: 11, lineItemCount: LONG_LINE_ITEMS });
      const mock = mockModel(latencyMs);
      const concurrency = concurrencyOf(variant);
      const extractor = createExtractor({
        loaders: [withRasterizer(new DocumentLoaderPdfJs(), new NapiCanvasRasterizer())],
        strategies: [vision({ model: mock.model, pageMode: "perPage", maxRetries: 0, ...(concurrency === undefined ? {} : { concurrency }) })],
      });
      const pass = async () => {
        const before = mock.requests();
        const result = await extractor.extract(document.bytes.slice(), Fields);
        return result.method === "vision" && result.data.invoiceNumber === "MOCK-1" ? mock.requests() - before : 0;
      };
      try {
        const cold = await timed(pass);
        const warm = await timed(pass);
        return {
          coldMs: cold.ms, warmMs: warm.ms, warmCpuMs: warm.cpuMs, units: warm.value, expected: document.pageCount,
          errors: shortfall(document.pageCount, cold.value, warm.value), detail: `${mock.requests()} requests`,
        };
      } finally {
        await extractor.dispose();
      }
    },
  },
  {
    group: "ocr",
    name: "tesseract",
    unit: "pages",
    variants: ["c1", "default"],
    describe: "DocumentConverter, DocumentLoaderTesseract + napi-canvas, 300 DPI, eng",
    async run(variant) {
      const document = await makeInvoicePdf({ seed: 5, lineItemCount: OCR_LINE_ITEMS });
      const concurrency = concurrencyOf(variant);
      const loader = new DocumentLoaderTesseract({ rasterizer: new NapiCanvasRasterizer(), ...(concurrency === undefined ? {} : { concurrency }) });
      return ocrRun(loader, document);
    },
  },
  {
    group: "ocr",
    name: "paddleocr",
    unit: "pages",
    variants: ["c1", "default"],
    describe: "DocumentConverter, DocumentLoaderPaddleOcr + napi-canvas, 300 DPI, CPU provider",
    async run(variant) {
      const document = await makeInvoicePdf({ seed: 5, lineItemCount: OCR_LINE_ITEMS });
      const concurrency = concurrencyOf(variant);
      const loader = new DocumentLoaderPaddleOcr({ rasterizer: new NapiCanvasRasterizer(), ...(concurrency === undefined ? {} : { concurrency }) });
      return ocrRun(loader, document);
    },
  },
  {
    group: "raster",
    name: "render",
    unit: "pages",
    variants: ["dpi150", "dpi300", "dpi300-edge1568"],
    describe: "NapiCanvasRasterizer.rasterize, every page of one long PDF, PNG",
    async run(variant) {
      const document = await makeInvoicePdf({ seed: 11, lineItemCount: LONG_LINE_ITEMS });
      const rasterizer = new NapiCanvasRasterizer();
      const options = { dpi: variant.startsWith("dpi150") ? 150 : 300, ...(variant.endsWith("edge1568") ? { maxEdge: 1568 } : {}) };
      const ctx = { signal: new AbortController().signal, logger: silentLogger };
      const pass = () => rasterizer.rasterize({ bytes: document.bytes.slice(), mimeType: "application/pdf" }, options, ctx);
      const cold = await timed(pass);
      const warm = await timed(pass);
      const first = warm.value[0];
      const megabytes = warm.value.reduce((sum, page) => sum + page.bytes.length, 0) / 1048576;
      return {
        coldMs: cold.ms, warmMs: warm.ms, warmCpuMs: warm.cpuMs, units: warm.value.length, expected: document.pageCount,
        errors: shortfall(document.pageCount, cold.value.length, warm.value.length),
        detail: `${first?.widthPx}x${first?.heightPx} px, ${megabytes.toFixed(1)} MiB PNG`,
      };
    },
  },
];

async function ocrRun(
  loader: DocumentLoaderTesseract | DocumentLoaderPaddleOcr,
  document: { readonly bytes: Uint8Array; readonly pageCount: number; readonly expected: { readonly invoiceNumber: string } },
): Promise<Omit<Sample, "maxRssMB">> {
  const converter = new DocumentConverter().loadDocumentLoader(loader);
  const source: () => DocumentSource = () => ({ bytes: document.bytes.slice(), mimeType: "application/pdf" });
  const pass = () => converter.convert(source(), { format: "markdown" });
  const recognised = (result: ConversionResult): number => result.pages.filter((page) => page.content.trim() !== "").length;
  try {
    const cold = await timed(pass);
    const warm = await timed(pass);
    const found = warm.value.content.includes(document.expected.invoiceNumber);
    return {
      coldMs: cold.ms, warmMs: warm.ms, warmCpuMs: warm.cpuMs, units: recognised(warm.value), expected: document.pageCount,
      errors: shortfall(document.pageCount, recognised(cold.value), recognised(warm.value)) + (found ? 0 : 1),
      detail: found ? "invoice number recognized" : "invoice number missing",
    };
  } finally {
    await converter.dispose();
  }
}

function packageVersion(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name?: string; version?: string };
      if (manifest.name === name) return manifest.version ?? "?";
    } catch {}
    directory = dirname(directory);
  }
  return "?";
}

function git(args: readonly string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "?";
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const span = (values: readonly number[], digits: number): string =>
  `${median(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)}-${Math.max(...values).toFixed(digits)})`;

function child(scenarioName: string, variant: string, latencyMs: number): Sample {
  const result = spawnSync(process.execPath, [
    fileURLToPath(import.meta.url), "--child", scenarioName, variant, String(latencyMs),
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  if (result.status !== 0 || !line.startsWith("{")) {
    throw new Error(`${scenarioName} ${variant} failed (exit ${result.status}): ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
  }
  return JSON.parse(line) as Sample;
}

async function main(argv: readonly string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  if (argv[0] === "--child") {
    const [, name, variant, latency] = argv;
    const scenario = scenarios.find((s) => s.name === name);
    if (scenario === undefined || variant === undefined) throw new Error(`unknown scenario ${name}`);
    const sample = await scenario.run(variant, Number(latency));
    console.log(JSON.stringify({ ...sample, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));
    return;
  }

  const reps = Number(flag("--reps") ?? 5);
  const latencyMs = Number(flag("--latency") ?? 100);
  const only = new Set((flag("--only") ?? "model,ocr,raster").split(","));
  const chosen = scenarios.filter((s) => only.has(s.group));
  const cpu = cpus()[0]?.model ?? "?";
  const dirty = git(["status", "--porcelain"]).split("\n").filter((l) => l !== "").length;

  console.log("Conditions");
  console.log(`  command      pnpm --filter @docture/examples exec node benchmarks/concurrency.ts ${argv.join(" ")}`.trimEnd());
  console.log(`  docture      ${packageVersion("docture")} at ${git(["rev-parse", "--short", "HEAD"])}${dirty > 0 ? ` with ${dirty} uncommitted paths` : ""}`);
  console.log(`  engines      node ${process.versions.node}, pdfjs-dist ${packageVersion("pdfjs-dist")}, @napi-rs/canvas ${packageVersion("@napi-rs/canvas")}, tesseract.js ${packageVersion("tesseract.js")}, ppu-paddle-ocr ${packageVersion("ppu-paddle-ocr")}, onnxruntime-node ${packageVersion("onnxruntime-node")}, ai ${packageVersion("ai")}`);
  console.log(`  hardware     ${cpu}, ${availableParallelism()} logical CPUs, ${Math.round(totalmem() / 2 ** 30)} GiB RAM (${Math.round(freemem() / 2 ** 30)} GiB free), ${platform()} ${release()}`);
  console.log(`  load         ${loadavg().map((l) => l.toFixed(2)).join(" ")} (1, 5, 15 min) at start`);
  console.log(`  repetitions  ${reps} per variant, alternating, after 1 discarded round; one fresh process per run`);
  console.log(`  model        deterministic mock provider, ${latencyMs} ms per request, no network`);
  console.log(`  inputs       batch ${BATCH_DOCUMENTS} one-page PDFs; long PDF ${LONG_LINE_ITEMS} line items; OCR PDF ${OCR_LINE_ITEMS} line items`);

  const samples = new Map<string, Sample[]>();
  for (const scenario of chosen) {
    for (let rep = 0; rep <= reps; rep += 1) {
      for (const variant of scenario.variants) {
        const sample = child(scenario.name, variant, latencyMs);
        if (rep === 0) continue;
        const key = `${scenario.name}\t${variant}`;
        samples.set(key, [...(samples.get(key) ?? []), sample]);
        if (argv.includes("--json")) console.log(JSON.stringify({ scenario: scenario.name, variant, rep, ...sample }));
      }
    }
  }

  console.log(`\nResults: median (min-max) of ${reps} runs. Warm throughput is units / warm seconds; CPU cores is process CPU time / wall time.`);
  console.log(["scenario", "variant", "units", "cold s", "warm s", "warm units/s", "warm CPU cores", "max RSS MiB", "errors", "check"].join(" | "));
  for (const scenario of chosen) {
    for (const variant of scenario.variants) {
      const runs = samples.get(`${scenario.name}\t${variant}`) ?? [];
      const units = runs[0]?.units ?? 0;
      console.log([
        scenario.name, variant, `${units} ${scenario.unit}`,
        span(runs.map((r) => r.coldMs / 1000), 2), span(runs.map((r) => r.warmMs / 1000), 2),
        span(runs.map((r) => (r.units * 1000) / r.warmMs), 2), span(runs.map((r) => r.warmCpuMs / r.warmMs), 1),
        span(runs.map((r) => r.maxRssMB), 0),
        String(runs.reduce((sum, r) => sum + r.errors, 0)), runs[0]?.detail ?? "",
      ].join(" | "));
    }
  }
  const short = chosen.flatMap((scenario) => scenario.variants.flatMap((variant) =>
    (samples.get(`${scenario.name}\t${variant}`) ?? [])
      .filter((r) => r.errors > 0 || r.units !== r.expected)
      .map((r) => `${scenario.name} ${variant}: ${r.units} of ${r.expected} ${scenario.unit} completed, ${r.errors} errors`)));
  console.log(`\nScenarios`);
  for (const scenario of chosen) console.log(`  ${scenario.name.padEnd(12)} ${scenario.describe}`);
  console.log(`  default      the option left unset; c1 is concurrency 1`);
  console.log(`  load         ${loadavg().map((l) => l.toFixed(2)).join(" ")} (1, 5, 15 min) at end`);
  if (short.length > 0) {
    console.error(`\nIncomplete work, so these rows do not measure what they describe:\n  ${short.join("\n  ")}`);
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
