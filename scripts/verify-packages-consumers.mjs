export const coreRuntime = String.raw`
import assert from "node:assert/strict";
import { createExtractor, documentLoaderData, defineStrategy, ContractViolationError } from "docture";
import { inMemoryLoader, loadedDocument, fixedStrategy } from "docture/testing/doubles";
import { scoreExtraction } from "docture/eval";
import { z } from "zod";

const text = "Invoice INV-42 total=17. This text is long enough for the text extraction strategy.";
const { PdfJsLoader } = await import("docture/loaders/pdfjs");
assert.equal(new PdfJsLoader().capabilities.text, true);
await assert.rejects(new PdfJsLoader().load({ bytes: new Uint8Array([1]), mimeType: "application/pdf" }, {
  signal: new AbortController().signal,
}), error => {
  assert.equal(error.code, "MISSING_ENGINE");
  assert.equal(error.engine, "pdfjs-dist");
  assert.equal(error.cause.code, "ERR_MODULE_NOT_FOUND");
  return true;
});
await assert.rejects(import("docture/testing/fixtures"), error => {
  assert.match(error.message, /pdfkit/);
  assert.equal(error.code, "ERR_MODULE_NOT_FOUND");
  return true;
});
const schema = z.object({ invoice: z.string(), total: z.number() });
const source = { bytes: new TextEncoder().encode(text), mimeType: "text/plain" };
let received;
const strategy = defineStrategy({
  name: "parse-invoice",
  async extract(context) {
    received = context.document.text;
    const match = /Invoice (INV-\d+) total=(\d+)/.exec(context.document.text);
    assert.ok(match, "the real data loader delivers the invoice text");
    return { data: { invoice: match[1], total: Number(match[2]) } };
  },
});
const extractor = createExtractor({ loaders: [documentLoaderData()], strategies: [strategy] });
const result = await extractor.extract(source, schema);
assert.equal(received, text);
assert.deepEqual(result.data, { invoice: "INV-42", total: 17 });
assert.deepEqual(result.validation, { valid: true, issues: [] });
assert.equal(result.method, "parse-invoice");
assert.equal(result.loader, "DocumentLoaderData");
assert.deepEqual(result.attempts.map(({ strategy, status }) => ({ strategy, status })), [
  { strategy: "parse-invoice", status: "ok" },
]);
const invalid = createExtractor({
  loaders: [documentLoaderData()],
  strategies: [defineStrategy({ name: "invalid", async extract() { return { data: { invoice: 42 } }; } })],
});
const failure = await invalid.safeExtract(source, schema);
assert.equal(failure.ok, false);
assert.ok(failure.error instanceof ContractViolationError);
assert.equal(failure.error.code, "CONTRACT_VIOLATION");
assert.deepEqual(failure.error.issues.map(issue => issue.path).sort(), ["invoice", "total"]);
const doubles = createExtractor({
  loaders: [inMemoryLoader(loadedDocument([text]))],
  strategies: [fixedStrategy("fixture", { invoice: "INV-42", total: 17 })],
});
assert.deepEqual((await doubles.extract(source, schema)).data, { invoice: "INV-42", total: 17 });
const score = scoreExtraction({ invoice: "INV-42", total: 17 }, result.data);
assert.equal(score.f1, 1);
assert.equal(score.exactMatch, true);
const mismatch = scoreExtraction({ invoice: "INV-42", total: 99 }, result.data);
assert.equal(mismatch.exactMatch, false);
await Promise.all([extractor.dispose(), invalid.dispose(), doubles.dispose()]);
console.log("core extraction, validation, test doubles, and scoring work without engines");
`;

export const coreTypes = String.raw`
import { createExtractor, documentLoaderData, defineStrategy, type ExtractionResult } from "docture";
import { loadedDocument } from "docture/testing/doubles";
import { scoreExtraction } from "docture/eval";
import { z } from "zod";
const schema = z.object({ invoice: z.string(), total: z.number() });
const extractor = createExtractor({
  loaders: [documentLoaderData()],
  strategies: [defineStrategy({ name: "parse", async extract() { return { data: { invoice: "INV-42", total: 17 } }; } })],
});
const result = await extractor.extract({ loaded: loadedDocument(["invoice"]) }, schema);
const typed: ExtractionResult<{ invoice: string; total: number }> = result;
const invoice: string = typed.data.invoice;
const total: number = typed.data.total;
scoreExtraction({ invoice, total }, result.data);
`;

export const llmRuntime = String.raw`
import assert from "node:assert/strict";
import { createExtractor, ModelOutputError, DoctureError, preloadedFeatures, resolveSchema, silentLogger } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

const text = "Invoice INV-42 for seventeen widgets. The total due is 17 EUR. Please pay within thirty days.";
const schema = z.object({ invoice: z.string(), total: z.number() });
function modelFor(object) {
  return new MockLanguageModelV4({
    provider: "verification", modelId: "packed-mock",
    async doGenerate() {
      return {
        content: [{ type: "text", text: JSON.stringify(object) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 25, text: 25, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}
const document = loadedDocument([text]);
const model = modelFor({ invoice: "INV-42", total: 17 });
const extractor = createExtractor({
  loaders: [inMemoryLoader(document)], strategies: [llm({ model, maxRetries: 0 })],
});
const result = await extractor.extract(new Uint8Array([1]), schema);
assert.deepEqual(result.data, { invoice: "INV-42", total: 17 });
assert.equal(result.method, "llm");
assert.deepEqual(result.validation, { valid: true, issues: [] });
assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens, result.usage.totalTokens], [100, 25, 125]);
assert.equal(model.doGenerateCalls.length, 1);
assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes(text), "the SDK receives the loaded document");
const badModel = modelFor({ invoice: 42, total: "invalid" });
await assert.rejects(llm({ model: badModel, maxRetries: 0 }).extract({
  document, features: preloadedFeatures({ loaded: document }), schema: await resolveSchema(schema),
  signal: new AbortController().signal, logger: silentLogger,
}), error => {
  assert.ok(error instanceof ModelOutputError, "the LLM subpath shares the root error constructor");
  assert.ok(error instanceof DoctureError);
  assert.equal(error.constructor, ModelOutputError);
  assert.equal(error.code, "MODEL_OUTPUT_FAILED");
  assert.ok(NoObjectGeneratedError.isInstance(error.cause));
  assert.deepEqual([error.usage.inputTokens, error.usage.outputTokens], [100, 25]);
  return true;
});
await extractor.dispose();
console.log("real AI SDK extraction and shared error identity work without PDF or OCR engines");
`;

export const llmTypes = String.raw`
import { createExtractor, type ExtractionResult } from "docture";
import { llm, LlmStrategy } from "docture/llm/text";
import { loadedDocument } from "docture/testing/doubles";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
const model = new MockLanguageModelV4();
const strategy = llm({ model });
const concrete = new LlmStrategy({ model });
const result = await createExtractor({ strategies: [strategy, concrete] })
  .extract({ loaded: loadedDocument(["text"]) }, z.object({ value: z.string() }));
const value: string = result.data.value;
const typed: ExtractionResult<{ value: string }> = result;
void value; void typed;
`;

export const loaderRuntime = String.raw`
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { silentLogger, createDocumentConverter } from "docture";
import { PdfJsLoader } from "docture/loaders/pdfjs";
import { makeInvoicePdf, makeRichDocumentPdf } from "docture/testing/fixtures";
const loader = new PdfJsLoader();
const context = { signal: new AbortController().signal, logger: silentLogger };
const fixture = await makeInvoicePdf({ seed: 7, lineItemCount: 2 });
assert.equal(new TextDecoder().decode(fixture.bytes.slice(0, 5)), "%PDF-");
await writeFile("invoice.pdf", fixture.bytes);
const document = await loader.load({ bytes: fixture.bytes, mimeType: "application/pdf" }, context);
assert.equal(document.loader, "pdfjs");
assert.equal(document.pages.length, 1);
assert.equal(document.form, "digital");
assert.match(document.text, /INVOICE/);
assert.ok(document.text.includes(fixture.expected.invoiceNumber));
assert.ok(document.pages[0].lines.some(line => line.text.includes(fixture.expected.invoiceNumber)));
assert.equal(document.pages[0].pageNumber, 1);
assert.ok(document.pages[0].width > 500);
const scan = await makeInvoicePdf({ seed: 7, textless: true });
const empty = await loader.load({ bytes: scan.bytes, mimeType: "application/pdf" }, context);
assert.equal(empty.form, "scanned");
assert.equal(empty.text.trim(), "");
const rich = await makeRichDocumentPdf();
const converter = createDocumentConverter({ loaders: [new PdfJsLoader()] });
const converted = await converter.convert(rich.bytes, { format: "text" });
assert.equal(converted.method, "deterministic");
assert.ok(converted.content.includes(rich.expected.title));
assert.ok(converted.content.includes(rich.expected.secondPage));
await converter.dispose();
const malformed = { bytes: new TextEncoder().encode("%PDF-1.7 this is not a document"), mimeType: "application/pdf" };
await assert.rejects(loader.load(malformed, context), error => {
  assert.notEqual(error.code, "MISSING_ENGINE");
  assert.match(error.message, /^pdfjs could not open the document/);
  return true;
});
await assert.rejects(createDocumentConverter({ loaders: [new PdfJsLoader()] }).convert(malformed), error => {
  assert.equal(error.code, "LOAD_FAILED");
  assert.match(error.message, /^Every loader failed: pdfjs \(pdfjs could not open the document/);
  return true;
});
console.log("selected PDF.js engine reads real generated digital and textless PDF fixtures and rejects a damaged one");
`;

export const loaderTypes = String.raw`
import { silentLogger, type LoadedDocument } from "docture";
import { PdfJsLoader } from "docture/loaders/pdfjs";
import { makeInvoicePdf } from "docture/testing/fixtures";
const fixture = await makeInvoicePdf({ seed: 7 });
const document: LoadedDocument = await new PdfJsLoader().load(
  { bytes: fixture.bytes, mimeType: "application/pdf" },
  { signal: new AbortController().signal, logger: silentLogger },
);
const text: string = document.pages[0]?.text ?? "";
void text;
`;

export const conformanceTest = String.raw`
import { describeLoaderConformance } from "docture/testing/conformance";
import { PdfJsLoader } from "docture/loaders/pdfjs";
describeLoaderConformance({ name: "packed PDF.js", create: () => new PdfJsLoader() });
`;

export const bundleConsumers = {
  core: 'import * as api from "docture"; export { api }; export const extractor = new api.Extractor();\n',
  text: 'import * as api from "docture/llm/text"; export { api }; export const strategy = api.llm({ model: "verification/mock", maxRetries: 0 });\n',
  vision: 'import * as api from "docture/llm/vision"; export { api }; export const strategy = api.vision({ model: "verification/mock", maxRetries: 0 });\n',
  classifier: 'import * as api from "docture/llm/classifier"; export { api }; export const classifier = api.llmClassifier({ model: "verification/mock" });\n',
  layout: 'import * as api from "docture/llm/layout"; export { api }; export const analyzer = api.llmLayout({ model: "verification/mock" });\n',
  split: 'import * as api from "docture/llm/split"; export { api }; export const splitter = api.textSplitter({ model: "verification/mock", name: "verification-splitter" });\n',
  extractor: 'import { documentLoaderData } from "docture"; import * as api from "docture/llm/extractor"; export { api }; export const extractor = api.createLlmExtractor({ model: "verification/mock", vision: true, classifyWithModel: true, loaders: [documentLoaderData()] });\n',
  helpers: ["cache", "pricing", "prompt", "merge", "relax"].map(name => `import * as ${name} from "docture/llm/${name}";`).join(" ") + " export { cache, pricing, prompt, merge, relax };\n",
  broad: 'import { LLM } from "docture/llm"; export const backend = new LLM("verification/mock");\n',
};

const helperAssertions = String.raw`
assert.deepEqual(b.merge.mergePartials([{ invoice: "INV-1", items: [1] }, { total: 17, items: [2] }]), { invoice: "INV-1", items: [1, 2], total: 17 });
assert.deepEqual(b.relax.relaxJsonSchema({ type: "object", properties: { invoice: { type: "string" } }, required: ["invoice"] }), { type: "object", properties: { invoice: { type: "string" } } });
assert.equal(b.prompt.estimateTokens("Invoice INV-42 total 17"), 6);
assert.deepEqual(b.pricing.lookupPricing("openai/mock-model", { "mock-model": { inputPerMillion: 1, outputPerMillion: 2 } }), { inputPerMillion: 1, outputPerMillion: 2 });
const responses = b.cache.memoryCache();
await responses.set("invoice", { data: { total: 17 }, usage: { inputTokens: 3 } });
assert.deepEqual(await responses.get("invoice"), { data: { total: 17 }, usage: { inputTokens: 3 } });`;

const bundleAssertions = {
  core: 'assert.deepEqual(b.extractor.components, { loaders: [], strategies: [], classifiers: [], classifications: [] }); assert.equal(typeof b.api.createExtractor, "function");',
  text: 'assert.equal(b.strategy.name, "llm"); assert.deepEqual(b.strategy.requires, ["TEXT_LAYER"]); assert.equal(typeof b.api.LlmStrategy, "function");',
  vision: 'assert.equal(b.strategy.name, "vision"); assert.deepEqual(b.strategy.requires, ["RENDERABLE_PAGES"]); assert.equal(typeof b.api.VisionStrategy, "function");',
  classifier: 'assert.equal(b.classifier.name, "llm-classifier"); assert.equal(typeof b.api.LlmClassifier, "function");',
  layout: 'assert.equal(b.analyzer.name, "llm-layout"); assert.equal(typeof b.api.LlmLayoutAnalyzer, "function");',
  split: 'assert.equal(b.splitter.name, "verification-splitter"); assert.deepEqual(b.splitter.requires, ["TEXT_LAYER"]); assert.equal(typeof b.api.ImageSplitter, "function");',
  extractor: 'assert.deepEqual(Object.fromEntries(Object.entries(b.extractor.components).map(([kind, items]) => [kind, items.map(item => item.name)])), { loaders: ["DocumentLoaderData"], strategies: ["llm", "vision"], classifiers: ["llm-classifier"], classifications: [] });',
  helpers: helperAssertions,
  broad: 'assert.equal(b.backend.extraction().name, "llm"); assert.equal(b.backend.vision().name, "vision");',
};

export function bundleRuntime(profile) {
  return `import assert from "node:assert/strict"; import * as b from "./bundle.mjs"; ${bundleAssertions[profile]}\n`;
}

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function entryRuntime(expected) {
  return String.raw`
import assert from "node:assert/strict";
const expected = ${JSON.stringify(expected, null, 2)};
const outcomes = {};
for (const specifier of Object.keys(expected)) {
  try {
    await import(specifier);
    outcomes[specifier] = "loads";
  } catch (error) {
    const missing = error?.code === "ERR_MODULE_NOT_FOUND" ? /^Cannot find package '([^']+)'/.exec(error.message)?.[1] : undefined;
    outcomes[specifier] = missing === undefined ? String(error?.stack ?? error) : "needs " + missing;
  }
}
assert.deepEqual(outcomes, expected);
const b = {
  cache: await import("docture/llm/cache"),
  pricing: await import("docture/llm/pricing"),
  prompt: await import("docture/llm/prompt"),
  merge: await import("docture/llm/merge"),
  relax: await import("docture/llm/relax"),
};
${helperAssertions}
console.log(JSON.stringify(outcomes));
`;
}

export const missingEngineRuntime = String.raw`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DoctureError, LoadFailedError, MissingEngineError, createDocumentConverter, silentLogger } from "docture";
import { PdfJsLoader } from "docture/loaders/pdfjs";
import { MuPdfLoader, MuPdfRasterizer } from "docture/loaders/mupdf";
import { TesseractJsLoader } from "docture/loaders/tesseract";
import { PaddleOcrLoader } from "docture/loaders/paddleocr";
import { NapiCanvasRasterizer } from "docture/raster/canvas";

const manifest = JSON.parse(await readFile("node_modules/docture/package.json", "utf8"));
const png = new Uint8Array(Buffer.from("${pngBase64}", "base64"));
const pdf = { bytes: new TextEncoder().encode("%PDF-1.7\n"), mimeType: "application/pdf" };
const image = { bytes: png, mimeType: "image/png" };
const context = { signal: new AbortController().signal, logger: silentLogger };
const probes = [
  ["docture/loaders/pdfjs", ["pdfjs-dist"], () => new PdfJsLoader().load(pdf, context)],
  ["docture/loaders/mupdf", ["mupdf"], () => new MuPdfLoader().load(pdf, context)],
  ["docture/loaders/mupdf", ["mupdf"], () => new MuPdfRasterizer().rasterize(pdf, { pages: [1] }, context)],
  ["docture/raster/canvas", ["pdfjs-dist", "@napi-rs/canvas"], () => new NapiCanvasRasterizer().rasterize(pdf, { pages: [1] }, context)],
  ["docture/loaders/tesseract", ["tesseract.js"], () => new TesseractJsLoader().load(image, context)],
  ["docture/loaders/paddleocr", ["ppu-paddle-ocr"], () => new PaddleOcrLoader().load(image, context)],
];
const reports = [];
for (const [entry, engines, probe] of probes) {
  const error = await probe().then(() => undefined, failure => failure);
  assert.ok(error instanceof MissingEngineError, entry + " reports a missing engine: " + (error?.stack ?? error));
  assert.ok(error instanceof DoctureError);
  assert.equal(error.code, "MISSING_ENGINE");
  assert.equal(error.entry, entry);
  assert.ok(engines.includes(error.engine), entry + " names " + error.engine);
  assert.equal(error.range, manifest.peerDependencies[error.engine], error.engine + " range equals the packed peer range");
  assert.equal(error.message, entry + " needs the optional peer " + error.engine + "@" + error.range + ", which is not installed. Install it beside docture: npm install \"" + error.engine + "@" + error.range + "\".");
  assert.equal(error.cause?.code, "ERR_MODULE_NOT_FOUND");
  reports.push({ entry, engine: error.engine, range: error.range });
}
await assert.rejects(createDocumentConverter({ loaders: [new PdfJsLoader()] }).convert(pdf), error => {
  assert.ok(error instanceof MissingEngineError);
  assert.equal(error instanceof LoadFailedError, false);
  assert.equal(error.engine, "pdfjs-dist");
  return true;
});
console.log(JSON.stringify(reports));
`;

export const paddleRuntimeWithoutOnnx = String.raw`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MissingEngineError, silentLogger } from "docture";
import { PaddleOcrLoader } from "docture/loaders/paddleocr";
const manifest = JSON.parse(await readFile("node_modules/docture/package.json", "utf8"));
const image = { bytes: new Uint8Array(Buffer.from("${pngBase64}", "base64")), mimeType: "image/png" };
const error = await new PaddleOcrLoader().load(image, { signal: new AbortController().signal, logger: silentLogger }).then(() => undefined, failure => failure);
assert.ok(error instanceof MissingEngineError, String(error?.stack ?? error));
assert.equal(error.engine, "onnxruntime-node");
assert.equal(error.range, manifest.peerDependencies["onnxruntime-node"]);
assert.equal(error.entry, "docture/loaders/paddleocr");
assert.match(error.cause.message, /^Cannot find package 'onnxruntime-node' imported from .*ppu-paddle-ocr/);
console.log("PaddleOCR without ONNX Runtime names the runtime it needs");
`;

export const missingCanvasRuntime = String.raw`
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DoctureError, MissingEngineError, silentLogger } from "docture";
import { NapiCanvasRasterizer } from "docture/raster/canvas";

const manifest = JSON.parse(await readFile("node_modules/docture/package.json", "utf8"));
const rasterizer = await realpath(fileURLToPath(new URL("rasterizer.js", import.meta.resolve("docture/raster/canvas"))));
const pdfjs = createRequire(rasterizer).resolve("pdfjs-dist/legacy/build/pdf.mjs");
for (const from of [rasterizer, pdfjs]) {
  assert.throws(() => createRequire(from).resolve("@napi-rs/canvas"), { code: "MODULE_NOT_FOUND" }, "@napi-rs/canvas resolves from " + from);
}
const pdf = { bytes: new Uint8Array(await readFile("invoice.pdf")), mimeType: "application/pdf" };
const context = { signal: new AbortController().signal, logger: silentLogger };
const error = await new NapiCanvasRasterizer().rasterize(pdf, { pages: [1] }, context).then(() => undefined, failure => failure);
assert.ok(error instanceof MissingEngineError, "the canvas rasterizer reports the missing canvas: " + (error?.stack ?? error));
assert.ok(error instanceof DoctureError);
assert.equal(error.engine, "@napi-rs/canvas");
assert.equal(error.range, manifest.peerDependencies["@napi-rs/canvas"]);
assert.equal(error.entry, "docture/raster/canvas");
assert.equal(error.message, "docture/raster/canvas needs the optional peer @napi-rs/canvas@" + error.range + ", which is not installed. Install it beside docture: npm install \"@napi-rs/canvas@" + error.range + "\".");
assert.equal(error.cause?.code, "ERR_MODULE_NOT_FOUND");
assert.ok(error.cause.message.startsWith("Cannot find package '@napi-rs/canvas' imported from " + rasterizer), error.cause.message);
console.log(JSON.stringify({ rasterizer, pdfjs, engine: error.engine, range: error.range, entry: error.entry }));
`;

export const engineConformanceTest = String.raw`
import { describeLoaderConformance, describeRasterizerConformance } from "docture/testing/conformance";
import { PdfJsLoader } from "docture/loaders/pdfjs";
import { MuPdfLoader, MuPdfRasterizer } from "docture/loaders/mupdf";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
describeLoaderConformance({ name: "pdfjs", create: () => new PdfJsLoader() });
describeLoaderConformance({ name: "mupdf", create: () => new MuPdfLoader() });
describeRasterizerConformance({ name: "canvas", create: () => new NapiCanvasRasterizer() });
describeRasterizerConformance({ name: "mupdf raster", create: () => new MuPdfRasterizer() });
`;

export const pdfjsAdoptionRuntime = String.raw`
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createExtractor, defineStrategy, documentLoaderData, silentLogger } from "docture";
import { PdfJsLoader } from "docture/loaders/pdfjs";
import { z } from "zod";
const schema = z.object({ text: z.string() });
const core = createExtractor({
  loaders: [documentLoaderData()],
  strategies: [defineStrategy({ name: "echo", async extract(context) { return { data: { text: context.document.text } }; } })],
});
const result = await core.extract({ bytes: new TextEncoder().encode("core extraction beside an application's own PDF.js"), mimeType: "text/plain" }, schema);
assert.deepEqual(result.data, { text: "core extraction beside an application's own PDF.js" });
const document = await new PdfJsLoader().load({ bytes: new Uint8Array(await readFile("invoice.pdf")), mimeType: "application/pdf" }, { signal: new AbortController().signal, logger: silentLogger });
assert.equal(document.form, "digital");
assert.match(document.text, /INVOICE/);
console.log("core extraction and the PDF.js adapter work beside the application's PDF.js version");
`;

export const pdfkitAdoptionRuntime = String.raw`
import assert from "node:assert/strict";
import { makeInvoicePdf } from "docture/testing/fixtures";
const fixture = await makeInvoicePdf({ seed: 7, lineItemCount: 2 });
assert.equal(new TextDecoder().decode(fixture.bytes.slice(0, 5)), "%PDF-");
assert.match(fixture.expected.invoiceNumber, /^INV-/);
console.log("fixtures generate PDFs with the application's PDFKit version");
`;

export const classifierRuntime = String.raw`
import assert from "node:assert/strict";
import { createExtractor, defineClassification } from "docture";
import { llmClassifier } from "docture/llm/classifier";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

const answers = [{ name: "invoice", confidence: 0.9, reason: "Invoice heading" }, { invoice: "INV-42", total: 17 }];
let calls = 0;
const model = new MockLanguageModelV4({
  provider: "verification", modelId: "zod-matrix",
  async doGenerate() {
    const answer = answers[Math.min(calls++, answers.length - 1)];
    return {
      content: [{ type: "text", text: JSON.stringify(answer) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    };
  },
});
const schema = z.object({ invoice: z.string(), total: z.number() });
const extractor = createExtractor({
  loaders: [inMemoryLoader(loadedDocument(["INVOICE INV-42. Seventeen widgets, total due 17 EUR within thirty days."]))],
  classifiers: [llmClassifier({ model, maxRetries: 0 })],
  classifications: [defineClassification({ name: "invoice", description: "A commercial invoice", schema })],
  strategies: [llm({ model, maxRetries: 0, needsClassification: "hint" })],
});
const result = await extractor.extract(new Uint8Array([1]), schema);
assert.deepEqual(result.data, { invoice: "INV-42", total: 17 });
assert.equal(result.classification?.name, "invoice");
assert.equal(result.classification?.confidence, 0.9);
assert.equal(calls, 2);
assert.equal(schema.safeParse({ invoice: 42, total: 17 }).success, false);
console.log("model classification and extraction work with the installed Zod release");
`;

export const classifierTypes = String.raw`
import { createExtractor, defineClassification, type ExtractionResult } from "docture";
import { llmClassifier } from "docture/llm/classifier";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
const schema = z.object({ invoice: z.string(), total: z.number() });
const model = new MockLanguageModelV4();
const result = await createExtractor({
  loaders: [inMemoryLoader(loadedDocument(["text"]))],
  classifiers: [llmClassifier({ model })],
  classifications: [defineClassification({ name: "invoice", description: "An invoice", schema })],
  strategies: [llm({ model })],
}).extract(new Uint8Array([1]), schema);
const typed: ExtractionResult<{ invoice: string; total: number }> = result;
const total: number = result.data.total;
void typed; void total;
`;

export const cliPeerContexts = {
  schema: JSON.stringify({ type: "object", properties: { invoiceNumber: { type: "string" } }, required: ["invoiceNumber"] }),
  usage: String.raw`
import { llm } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { MockLanguageModelV4 } from "ai/test";
const answer = (text, input, output) => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } },
  warnings: [],
});
const bad = new MockLanguageModelV4({ provider: "verification", modelId: "bad", async doGenerate() { return answer("not json at all", 1000, 250); } });
const good = new MockLanguageModelV4({ provider: "verification", modelId: "good", async doGenerate() { return answer(JSON.stringify({ invoiceNumber: "INV-1" }), 10, 5); } });
export default {
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [llm({ model: bad, name: "bad", maxRetries: 0 }), llm({ model: good, name: "good", maxRetries: 0 })],
};
`,
  noStrategy: String.raw`
import { Extractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default { extractor: () => new Extractor().loadDocumentLoader(new DocumentLoaderPdfJs()) };
`,
  timeout: String.raw`
import { TimeoutError } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default {
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [
    { name: "nested", async extract() { throw new TimeoutError("extract:inner", 5); } },
    { name: "good", async extract() { return { data: { invoiceNumber: "INV-2" } }; } },
  ],
};
`,
  probe: String.raw`
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const app = await import("docture");
const cliDocture = createRequire(realpathSync("node_modules/@docture/cli") + "/package.json").resolve("docture");
const cli = await import(pathToFileURL(cliDocture).href);
assert.notEqual(app.DoctureError, cli.DoctureError, "the application and the CLI load separate docture copies");
assert.equal(new app.TimeoutError("extract:inner", 5) instanceof cli.DoctureError, true);
assert.equal(new app.TimeoutError("extract:inner", 5) instanceof cli.TimeoutError, true);
assert.equal(new app.TimeoutError("extract:inner", 5) instanceof cli.ModelOutputError, false);
assert.equal(cli.isAbortError(new app.TimeoutError("extract:inner", 5)), false);
assert.equal(cli.isAbortError(new DOMException("caller timeout", "TimeoutError")), true);
assert.equal(cli.errorCodeOf(new app.ModelOutputError("unparseable")), "MODEL_OUTPUT_FAILED");
assert.equal(cli.errorCodeOf(new Error("plain")), undefined);
console.log(JSON.stringify({ application: realpathSync(new URL(import.meta.resolve("docture")).pathname), cli: cliDocture }));
`,
  canvases: String.raw`
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
const cliDocture = createRequire(realpathSync("node_modules/@docture/cli") + "/package.json").resolve("docture");
const pdfjs = createRequire(cliDocture).resolve("pdfjs-dist/legacy/build/pdf.mjs");
const canvas = from => {
  const manifest = realpathSync(createRequire(from).resolve("@napi-rs/canvas/package.json"));
  return { manifest, version: JSON.parse(readFileSync(manifest, "utf8")).version };
};
console.log(JSON.stringify({ rasterizer: canvas(cliDocture), pdfjs: canvas(pdfjs) }));
`,
};

export const cliMissingEngineConfig = String.raw`
import { DocumentLoaderMuPdf } from "docture/loaders/mupdf";
export default { loaders: [new DocumentLoaderMuPdf()] };
`;

function visionConfig({ applicationLoader }) {
  return String.raw`
import { vision } from "docture/llm/vision";
${applicationLoader ? 'import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";' : ""}
import { MockLanguageModelV4 } from "ai/test";
const model = new MockLanguageModelV4({
  provider: "verification", modelId: "vision",
  async doGenerate(options) {
    const images = options.prompt.flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(part => part.type === "file" && part.mediaType.startsWith("image/")).length;
    return {
      content: [{ type: "text", text: JSON.stringify({ invoiceNumber: "INV-" + images }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    };
  },
});
export default {
  ${applicationLoader ? "loaders: [new DocumentLoaderPdfJs()]," : ""}
  strategies: [vision({ model, maxRetries: 0 })],
};
`;
}

export const cliVisionConfig = visionConfig({ applicationLoader: false });
export const cliApplicationLoaderVisionConfig = visionConfig({ applicationLoader: true });

const typedHeader = 'import { defineConfig } from "@docture/cli";\n';

export const typedCliConfigs = {
  docture: {
    "extractor-value.config.ts": typedHeader + String.raw`import { createExtractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({ extractor: createExtractor({ loaders: [new DocumentLoaderPdfJs()] }) });
`,
    "extractor-factory.config.ts": typedHeader + String.raw`import { Extractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({ extractor: () => new Extractor().loadDocumentLoader(new DocumentLoaderPdfJs()) });
`,
    "extractor-async.config.ts": typedHeader + String.raw`import { writeFileSync } from "node:fs";
import { createExtractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({
  extractor: async () => createExtractor({
    loaders: [new DocumentLoaderPdfJs()],
    strategies: [{
      name: "typed",
      async extract() { return { data: { invoiceNumber: "INV-TYPED" } }; },
      async dispose() { writeFileSync("extractor-disposed.txt", "disposed"); },
    }],
  }),
});
`,
    "converter-value.config.ts": typedHeader + String.raw`import { createDocumentConverter } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({ converter: createDocumentConverter({ loaders: [new DocumentLoaderPdfJs()] }) });
`,
    "converter-factory.config.ts": typedHeader + String.raw`import { DocumentConverter } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({ converter: () => new DocumentConverter({ loaders: [new DocumentLoaderPdfJs()] }) });
`,
    "converter-async.config.ts": typedHeader + String.raw`import { writeFileSync } from "node:fs";
import { createDocumentConverter, type DocumentLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
const pdf = new DocumentLoaderPdfJs();
const recording: DocumentLoader = {
  name: pdf.name,
  capabilities: pdf.capabilities,
  load: (document, context) => pdf.load(document, context),
  async dispose() { writeFileSync("converter-disposed.txt", "disposed"); },
};
export default defineConfig({ converter: async () => createDocumentConverter({ loaders: [recording] }) });
`,
  },
  components: {
    "components.config.ts": typedHeader + String.raw`import { declarationOrder, defineClassification, defineStrategy } from "docture";
import { llmClassifier } from "docture/llm/classifier";
import { llmLayout } from "docture/llm/layout";
import { llm } from "docture/llm/text";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
const model = new MockLanguageModelV4();
export default defineConfig({
  loaders: [new DocumentLoaderPdfJs()],
  strategies: [defineStrategy({ name: "fixed", async extract() { return { data: { invoiceNumber: "INV-1" } }; } }), llm({ model })],
  classifiers: [llmClassifier({ model })],
  classifications: [defineClassification({ name: "invoice", description: "An invoice", schema: z.object({ invoiceNumber: z.string() }) })],
  policy: declarationOrder,
  layoutAnalyzer: llmLayout({ model }),
});
`,
  },
  invalid: {
    "extractor-missing-methods.config.ts": {
      source: typedHeader + "export default defineConfig({ extractor: () => ({ dispose: async () => {} }) });\n",
      code: 2322,
      // TypeScript 5 and 7 list the missing methods in different orders.
      message: /is missing the following properties from type 'CliExtractor': (?=.*\bextractBatch\b)(?=.*\bclassify\b).*\bextract\b/,
    },
    "converter-given-extractor.config.ts": {
      source: typedHeader + String.raw`import { createExtractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
export default defineConfig({ converter: () => createExtractor({ loaders: [new DocumentLoaderPdfJs()] }) });
`,
      code: 2322,
      message: /Property 'convertBatch' is missing in type 'Extractor' but required in type 'CliConverter'/,
    },
  },
};
