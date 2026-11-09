import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ContractViolationError,
  DuplicateComponentError,
  Extractor,
  ExtractionFailedError,
  LoadFailedError,
  MissingEngineError,
  NoEligibleLoaderError,
  NoEligibleStrategyError,
  TimeoutError,
  createExtractor,
  defineStrategy,
  isCallerAbort,
  isDoctureError,
  preloadedFeatures,
  DoctureError,
  UnsupportedSourceError,
  type DoctureErrorCode,
  type ModelBackend,
} from "../../src/core/index.js";
import { DoclingImportError } from "../../src/import/docling/boundary.js";
import { PaperlessError } from "../../src/paperless/transport.js";
import { PDF_BYTES, doc, fakeLoader, fakeStrategy } from "./fakes.js";

const Total = z.object({ total: z.number() });

describe("error hints", () => {
  it("gives every error a hint that names the library call to make", () => {
    expect(new TimeoutError("extract:slow", 25).hint).toBe(
      "A stage hit its stageTimeoutMs deadline. Raise stageTimeoutMs, or omit it for no stage deadline.",
    );
    expect(new MissingEngineError("pdfjs-dist", "^6.2.108", "docture/loaders/pdfjs").hint).toBe(
      "Install the engine package named in the message beside docture, or remove the component that needs it.",
    );
  });

  it("tells a rule failure apart from a schema failure", () => {
    const issue = [{ path: "total", message: "does not match the lines" }];
    expect(new ContractViolationError("s", issue).hint).toBe(
      "Loosen the schema at the paths listed in issues, or steer the model with instructions or per-field descriptions.",
    );
    expect(new ContractViolationError("s", issue, { failedCheck: "rule" }).hint).toBe(
      "The data satisfies the schema but failed a validation rule in fail mode. Check the rule's issues against the document, " +
        'or set onRuleFailure: "report" to keep the data with its issues.',
    );
  });
});

describe("error serialization", () => {
  it("keeps attempts, usage and nested causes as JSON", () => {
    const attempt = { stage: "extract" as const, strategy: "s", status: "failed" as const, ms: 3, error: "boom" };
    const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12, wallMs: 3 };
    expect(JSON.parse(JSON.stringify(new ExtractionFailedError([attempt], { usage })))).toEqual({
      code: "EXTRACTION_FAILED",
      name: "ExtractionFailedError",
      message: "Every extraction strategy failed: s (boom).",
      hint: "Read each entry in attempts for the strategy's error, fix that strategy or its model credentials, or register a fallback strategy after it.",
      attempts: [attempt],
      usage,
    });
    const cause = Object.assign(new Error("Cannot find package 'pdfjs-dist'"), { code: "ERR_MODULE_NOT_FOUND" });
    expect(new MissingEngineError("pdfjs-dist", "^6.2.108", "docture/loaders/pdfjs", { cause }).toJSON()).toMatchObject({
      engine: "pdfjs-dist",
      range: "^6.2.108",
      entry: "docture/loaders/pdfjs",
      cause: { code: "ERR_MODULE_NOT_FOUND", name: "Error", message: "Cannot find package 'pdfjs-dist'" },
    });
  });

  it("keeps a document's features and each strategy's gap", () => {
    const features = preloadedFeatures({ loaded: doc("Invoice INV-1") });
    const json = new NoEligibleStrategyError(features, [{ name: "vision", reason: "needs RENDERABLE_PAGES", missing: ["RENDERABLE_PAGES"] }]).toJSON();
    expect(json.gaps).toEqual([{ name: "vision", reason: "needs RENDERABLE_PAGES", missing: ["RENDERABLE_PAGES"] }]);
    expect(json.features).toEqual(JSON.parse(JSON.stringify(features)));
  });
});

describe("isDoctureError with a code", () => {
  it("narrows to that code's error and rejects others", () => {
    const error: unknown = new TimeoutError("extract:slow", 25);
    expect(isDoctureError(error, "TIMEOUT") ? error.stage : undefined).toBe("extract:slow");
    expect(isDoctureError(error, "LOAD_FAILED")).toBe(false);
    expect(isDoctureError(new LoadFailedError([]), "LOAD_FAILED")).toBe(true);
    expect(isDoctureError(Object.assign(new Error("lookalike"), { code: "TIMEOUT" }), "TIMEOUT")).toBe(false);
  });

  it("narrows a core code only for that code's class, so its fields exist at runtime", () => {
    class Wrapped extends DoctureError {
      override readonly code: DoctureErrorCode;
      constructor(override readonly cause: DoctureError) {
        super(cause.message, { cause });
        this.code = cause.code;
      }
    }
    const wrapped = new Wrapped(new ExtractionFailedError([]));
    expect(wrapped.code).toBe("EXTRACTION_FAILED");
    expect(isDoctureError(wrapped, "EXTRACTION_FAILED")).toBe(false);
    expect(isDoctureError(wrapped.cause, "EXTRACTION_FAILED") ? wrapped.cause.attempts : undefined).toEqual([]);
    expect(isDoctureError(wrapped)).toBe(true);
  });

  it("matches adapter source errors as UNSUPPORTED_SOURCE errors", () => {
    const paperless = new PaperlessError("Paperless returned 404.", "http", 404);
    const docling = new DoclingImportError("version", "only schema 1.10.0 is supported");
    expect([isDoctureError(paperless, "UNSUPPORTED_SOURCE"), isDoctureError(docling, "UNSUPPORTED_SOURCE")]).toEqual([true, true]);
    expect([paperless instanceof UnsupportedSourceError, docling instanceof UnsupportedSourceError]).toEqual([true, true]);
    expect([paperless instanceof PaperlessError, docling instanceof PaperlessError]).toEqual([true, false]);
    expect(paperless.toJSON()).toEqual({
      code: "UNSUPPORTED_SOURCE",
      name: "PaperlessError",
      message: "Paperless returned 404.",
      hint: paperless.hint,
      kind: "http",
      status: 404,
      outcome: "rejected",
    });
    expect(docling.toJSON()).toMatchObject({ code: "UNSUPPORTED_SOURCE", name: "DoclingImportError", path: "version" });
  });

  it("keeps the plain code check for codes outside core", () => {
    class EvalLike extends DoctureError {
      override readonly code = "OUT_OF_SCOPE" as const;
    }
    expect(isDoctureError(new EvalLike("declined"), "OUT_OF_SCOPE")).toBe(true);
    expect(isDoctureError(new EvalLike("declined"), "TIMEOUT")).toBe(false);
  });
});

describe("isCallerAbort", () => {
  it("is false for a component's own abort-shaped error while the caller's signal is live", () => {
    const own = new DOMException("The operation timed out.", "TimeoutError");
    expect(isCallerAbort(own, new AbortController().signal)).toBe(false);
    expect(isCallerAbort(own, undefined)).toBe(false);
  });

  it("is true for the caller's reason, custom or standard, once the signal aborted", () => {
    const controller = new AbortController();
    const reason = new Error("user closed the tab");
    controller.abort(reason);
    expect(isCallerAbort(reason, controller.signal)).toBe(true);
    expect(isCallerAbort(new DOMException("stop", "AbortError"), controller.signal)).toBe(true);
    expect(isCallerAbort(new Error("provider exploded"), controller.signal)).toBe(false);
  });
});

describe("messages that name the fix", () => {
  it("says to register a strategy when none is wired", async () => {
    const error = await createExtractor({ loaders: [fakeLoader()] }).extract(PDF_BYTES, Total).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoEligibleStrategyError);
    expect((error as Error).message).toBe(
      "No extraction strategy is registered (textLayer=true, geometry=true, renderable=false). " +
        "Call loadLlm(...) or loadStrategy(...) before extracting.",
    );
  });

  it("says to wrap the loader with a rasterizer when a strategy needs page images", async () => {
    const images = defineStrategy({ name: "vision", requires: ["RENDERABLE_PAGES"], async extract() { return { data: {} }; } });
    const error = await createExtractor({ loaders: [fakeLoader()], strategies: [images] }).extract(PDF_BYTES, Total).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      "No extraction strategy is eligible for this document (textLayer=true, geometry=true, renderable=false). " +
        "vision: needs RENDERABLE_PAGES. To give strategies page images, wrap the loader with withRasterizer(loader, rasterizer).",
    );
  });

  it("lists why each loader declined the media type", async () => {
    const error = await createExtractor({ loaders: [fakeLoader({ name: "pdf" })], strategies: [fakeStrategy()] })
      .extract({ bytes: new TextEncoder().encode("a,b"), mimeType: "text/csv" }, Total)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoEligibleLoaderError);
    expect((error as Error).message).toBe(
      'No loader accepts "text/csv". pdf: accepts application/pdf, not "text/csv". Register a loader for "text/csv" with loadDocumentLoader(...).',
    );
  });

  it("names the singular component kind in a duplicate", () => {
    let error: unknown;
    try {
      new Extractor({ strategies: [fakeStrategy({ name: "s" }), fakeStrategy({ name: "s" })] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DuplicateComponentError);
    expect((error as Error).message).toBe('A strategy named "s" is already registered. Give one of them a distinct name.');
  });
});

describe("loadLlm wiring", () => {
  const backend = (id: string, classify = true): ModelBackend => ({
    id,
    extraction: () => fakeStrategy({ name: id, data: { total: 1 } }),
    ...(classify ? { classifier: () => ({ name: `${id}:classifier`, async classify() { return { classifier: `${id}:classifier`, name: null, confidence: 0 }; } }) } : {}),
  });

  it("registers nothing when an option cannot be honoured", () => {
    const extractor = new Extractor();
    expect(() => extractor.loadLlm(backend("m", false), { classify: true })).toThrow(
      'Model "m" has no classifier, so { classify: true } cannot be honoured.',
    );
    expect(extractor.components.strategies).toEqual([]);
  });

  it("explains a second loadLlm of the same model and leaves the first wiring intact", () => {
    const extractor = new Extractor().loadLlm(backend("gpt-5"));
    expect(() => extractor.loadLlm(backend("gpt-5"), { classify: true })).toThrow(
      'A strategy named "gpt-5" is already registered. If loadLlm(...) was called twice with the same model, ' +
        "pass { vision: true, classify: true } in the first call. Otherwise give this LLM a distinct { name }.",
    );
    expect(extractor.components.strategies.map((s) => s.name)).toEqual(["gpt-5"]);
    expect(extractor.components.classifiers).toEqual([]);
  });

  it("accepts a model in the options object, after the explicit strategies", () => {
    const extractor = new Extractor({
      strategies: [fakeStrategy({ name: "parser" })],
      llm: { backend: backend("gpt-5"), classify: true },
    });
    expect(extractor.components.strategies.map((s) => s.name)).toEqual(["parser", "gpt-5"]);
    expect(extractor.components.classifiers.map((c) => c.name)).toEqual(["gpt-5:classifier"]);
    expect(new Extractor({ llm: backend("m") }).components.strategies.map((s) => s.name)).toEqual(["m"]);
  });
});

describe("extractBatch after the caller aborts", () => {
  it("runs no component for a later source and reports each remaining one as aborted", async () => {
    const controller = new AbortController();
    let started = 0;
    const strategy = defineStrategy({
      name: "counting",
      async extract() {
        started += 1;
        if (started === 1) controller.abort(new Error("caller stopped"));
        return { data: { total: started } };
      },
    });
    const items = [];
    for await (const item of createExtractor({ loaders: [fakeLoader()], strategies: [strategy] })
      .extractBatch([PDF_BYTES, PDF_BYTES, PDF_BYTES], Total, { concurrency: 1, signal: controller.signal })) {
      items.push(item.outcome.ok ? "ok" : (item.outcome.error as Error).message);
    }
    expect(started).toBe(1);
    expect(items).toEqual(["caller stopped", "caller stopped", "caller stopped"]);
  });
});
