import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import * as core from "../../src/core/index.js";
import {
  createDocumentConverter,
  createExtractor,
  defineStrategy,
  errorCodeOf,
  isAbortError,
  preloadedFeatures,
  type DoctureError,
} from "../../src/core/index.js";
import { PDF_BYTES, doc, fakeLoader } from "./fakes.js";

type ErrorsModule = typeof import("../../src/core/pipeline/errors.js");

let copy: ErrorsModule;
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "docture-second-copy-"));
  const target = join(directory, "errors.ts");
  await copyFile(fileURLToPath(new URL("../../src/core/pipeline/errors.ts", import.meta.url)), target);
  copy = await import(pathToFileURL(target).href);
});

afterAll(() => rm(directory, { recursive: true, force: true }));

const features = preloadedFeatures({ loaded: doc("Invoice INV-1") });

const names = [
  "PageSelectionError",
  "ModelOutputError",
  "NoEligibleLoaderError",
  "LoadFailedError",
  "NoConvertibleContentError",
  "NoEligibleStrategyError",
  "ExtractionFailedError",
  "ContractViolationError",
  "UnsupportedSourceError",
  "TimeoutError",
  "DuplicateComponentError",
  "SplitFailedError",
  "UnclassifiedGroupError",
  "MissingEngineError",
  "MissingComponentError",
] as const;
type ErrorName = (typeof names)[number];

const samples: Record<ErrorName, (m: ErrorsModule) => DoctureError> = {
  PageSelectionError: (m: ErrorsModule) => new m.PageSelectionError([3], 2),
  ModelOutputError: (m: ErrorsModule) => new m.ModelOutputError("unparseable", { usage: { inputTokens: 1000 } }),
  NoEligibleLoaderError: (m: ErrorsModule) => new m.NoEligibleLoaderError("text/csv", []),
  LoadFailedError: (m: ErrorsModule) => new m.LoadFailedError([]),
  NoConvertibleContentError: (m: ErrorsModule) => new m.NoConvertibleContentError(features),
  NoEligibleStrategyError: (m: ErrorsModule) => new m.NoEligibleStrategyError(features, []),
  ExtractionFailedError: (m: ErrorsModule) => new m.ExtractionFailedError([]),
  ContractViolationError: (m: ErrorsModule) => new m.ContractViolationError("parser", []),
  UnsupportedSourceError: (m: ErrorsModule) => new m.UnsupportedSourceError("ftp is not supported"),
  TimeoutError: (m: ErrorsModule) => new m.TimeoutError("extract:slow", 5),
  DuplicateComponentError: (m: ErrorsModule) => new m.DuplicateComponentError("loader", "pdfjs"),
  SplitFailedError: (m: ErrorsModule) => new m.SplitFailedError("no splitter"),
  UnclassifiedGroupError: (m: ErrorsModule) => new m.UnclassifiedGroupError([1], "memo", ["invoice"]),
  MissingEngineError: (m: ErrorsModule) => new m.MissingEngineError("mupdf", "~1.28.0", "docture/loaders/mupdf"),
  MissingComponentError: (m: ErrorsModule) => new m.MissingComponentError("missing loader"),
};

const codes: Record<ErrorName, string> = {
  PageSelectionError: "PAGE_OUT_OF_RANGE",
  ModelOutputError: "MODEL_OUTPUT_FAILED",
  NoEligibleLoaderError: "NO_ELIGIBLE_LOADER",
  LoadFailedError: "LOAD_FAILED",
  NoConvertibleContentError: "NO_CONVERTIBLE_CONTENT",
  NoEligibleStrategyError: "NO_ELIGIBLE_STRATEGY",
  ExtractionFailedError: "EXTRACTION_FAILED",
  ContractViolationError: "CONTRACT_VIOLATION",
  UnsupportedSourceError: "UNSUPPORTED_SOURCE",
  TimeoutError: "TIMEOUT",
  DuplicateComponentError: "DUPLICATE_COMPONENT",
  SplitFailedError: "SPLIT_FAILED",
  UnclassifiedGroupError: "UNCLASSIFIED_GROUP",
  MissingEngineError: "MISSING_ENGINE",
  MissingComponentError: "MISSING_COMPONENT",
};

describe("errors from another installed copy of docture", () => {
  it("loads physically separate classes", () => {
    expect(copy.DoctureError).not.toBe(core.DoctureError);
    expect(copy.ModelOutputError).not.toBe(core.ModelOutputError);
  });

  it("covers every error class the root entry exports", () => {
    const exported = Object.entries(core)
      .filter(([, value]) => typeof value === "function" && value.prototype instanceof core.DoctureError)
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual([...names].sort());
  });

  it.each(names)("recognises %s as its own class and no sibling", (name) => {
    const foreign = samples[name](copy);
    expect(foreign instanceof core[name]).toBe(true);
    expect(foreign instanceof core.DoctureError).toBe(true);
    expect(errorCodeOf(foreign)).toBe(codes[name]);
    const siblings = names.filter((other) => other !== name && foreign instanceof core[other]);
    expect(siblings).toEqual([]);
  });

  it("keeps ordinary semantics for subclasses declared by an application", () => {
    class RateLimitedOutput extends copy.ModelOutputError {}
    class TimeoutLike extends core.DoctureError {
      override readonly code = "TIMEOUT" as const;
    }
    const subclass = new RateLimitedOutput("retry later");

    expect(subclass instanceof core.ModelOutputError).toBe(true);
    expect(subclass instanceof core.DoctureError).toBe(true);
    expect(subclass instanceof RateLimitedOutput).toBe(true);
    expect(new copy.ModelOutputError("plain") instanceof RateLimitedOutput).toBe(false);
    expect(new core.ModelOutputError("plain") instanceof RateLimitedOutput).toBe(false);
    expect(new TimeoutLike("same code") instanceof core.TimeoutError).toBe(false);
    expect(new TimeoutLike("same code") instanceof copy.TimeoutError).toBe(false);
    expect(new TimeoutLike("same code") instanceof copy.DoctureError).toBe(true);
  });

  it("does not adopt native, application or forged errors", () => {
    const forged = Object.assign(new Error("forged"), { name: "ModelOutputError", code: "MODEL_OUTPUT_FAILED" });
    const values: unknown[] = [
      new Error("plain"),
      new TypeError("type"),
      new DOMException("caller timeout", "TimeoutError"),
      new DOMException("caller abort", "AbortError"),
      forged,
      { name: "TimeoutError", code: "TIMEOUT" },
      Object.create(null),
      null,
      undefined,
      "TimeoutError",
    ];
    expect(values.map((value) => value instanceof core.DoctureError)).toEqual(values.map(() => false));
    expect(values.map((value) => value instanceof core.ModelOutputError)).toEqual(values.map(() => false));
    expect(values.map((value) => errorCodeOf(value))).toEqual(values.map(() => undefined));
  });

  it("treats a library timeout from another copy as a failed stage, not a caller abort", () => {
    expect(isAbortError(new copy.TimeoutError("extract:slow", 5))).toBe(false);
    expect(isAbortError(new copy.ModelOutputError("unparseable"))).toBe(false);
    expect(isAbortError(new DOMException("caller timeout", "TimeoutError"))).toBe(true);
    expect(isAbortError(new DOMException("caller abort", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("plain"))).toBe(false);
  });
});

describe("pipelines that receive errors from another copy", () => {
  const Invoice = z.object({ invoice: z.string() });

  it("keeps the usage of a failed model call in the extraction total", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        defineStrategy({
          name: "bad",
          async extract() {
            throw new copy.ModelOutputError("unparseable", { usage: { inputTokens: 1000, outputTokens: 250 } });
          },
        }),
        defineStrategy({
          name: "good",
          async extract() {
            return { data: { invoice: "INV-1" }, usage: { inputTokens: 10, outputTokens: 5 } };
          },
        }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Invoice);

    expect(result.method).toBe("good");
    expect([result.usage.inputTokens, result.usage.outputTokens]).toEqual([1010, 255]);
    expect(result.attempts.map(({ strategy, status, errorCode, usage }) => ({ strategy, status, errorCode, usage }))).toEqual([
      { strategy: "bad", status: "failed", errorCode: "MODEL_OUTPUT_FAILED", usage: { inputTokens: 1000, outputTokens: 250 } },
      { strategy: "good", status: "ok", errorCode: undefined, usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
  });

  it("tries the next strategy after a timeout raised by another copy", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        defineStrategy({
          name: "nested",
          async extract() {
            throw new copy.TimeoutError("extract:inner", 5);
          },
        }),
        defineStrategy({ name: "good", async extract() { return { data: { invoice: "INV-2" } }; } }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Invoice);

    expect(result.data).toEqual({ invoice: "INV-2" });
    expect(result.attempts.map(({ strategy, errorCode }) => ({ strategy, errorCode }))).toEqual([
      { strategy: "nested", errorCode: "TIMEOUT" },
      { strategy: "good", errorCode: undefined },
    ]);
  });

  it("keeps the usage of a failed classifier call on its signal", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [defineStrategy({ name: "hinted", needsClassification: "hint", async extract() { return { data: { invoice: "INV-3" } }; } })],
      classifiers: [
        {
          name: "billed",
          async classify() {
            throw new copy.ModelOutputError("unparseable", { usage: { inputTokens: 40 } });
          },
        },
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Invoice);

    expect(result.classification?.signals).toEqual([
      { classifier: "billed", name: null, confidence: 0, note: "threw: unparseable", usage: { inputTokens: 40 } },
    ]);
  });

  it("keeps the usage of a failed layout analysis in the conversion total", async () => {
    const result = await createDocumentConverter({
      loaders: [fakeLoader()],
      layoutAnalyzer: {
        name: "billed-layout",
        async analyze() {
          throw new copy.ModelOutputError("unparseable", { usage: { inputTokens: 70, outputTokens: 3 } });
        },
      },
    }).convert(PDF_BYTES);

    expect([result.usage.inputTokens, result.usage.outputTokens]).toEqual([70, 3]);
    expect(result.attempts.at(-1)).toMatchObject({
      strategy: "billed-layout",
      status: "failed",
      errorCode: "MODEL_OUTPUT_FAILED",
      usage: { inputTokens: 70, outputTokens: 3 },
    });
  });
});
