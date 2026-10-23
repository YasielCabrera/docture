import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  ContractViolationError,
  DuplicateComponentError,
  ExtractionFailedError,
  LoadFailedError,
  NoEligibleLoaderError,
  NoEligibleStrategyError,
  createExtractor,
  type RoutingPolicy,
} from "../../src/core/index.js";
import {
  PDF_BYTES,
  doc,
  fakeClassifier,
  fakeLoader,
  fakeStrategy,
} from "./fakes.js";

const Simple = z.object({ value: z.string() });

describe("extract — the happy path", () => {
  it("returns data typed from the schema", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ data: { value: "hello" } })],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);

    expect(result.data).toEqual({ value: "hello" });
    expect(result.method).toBe("fake-strategy");
    expect(result.loader).toBe("fake");
    expect(result.validation.valid).toBe(true);

    // The claim that makes this library worth writing in TypeScript.
    expectTypeOf(result.data).toEqualTypeOf<{ value: string }>();
    expectTypeOf(result.data.value).toEqualTypeOf<string>();
  });

  it("infers from a schema of any Standard Schema library, not just Zod", async () => {
    // A hand-written JSON Schema carries no validator, so validation passes it
    // through — but the JSON Schema still reaches a strategy for prompting.
    const seen: unknown[] = [];
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({
          data: { anything: 1 },
          onExtract: (ctx) => seen.push(ctx.schema.jsonSchema),
        }),
      ],
    });

    await extractor.extract(PDF_BYTES, z.object({ anything: z.number() }));
    expect(seen[0]).toMatchObject({ type: "object" });
  });

  it("reports usage and wall time", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.004 } }),
      ],
    });
    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.costUsd).toBeCloseTo(0.004);
    expect(result.usage.wallMs).toBeGreaterThanOrEqual(0);
  });
});

describe("loaders", () => {
  it("falls back to the next loader and records the failure", async () => {
    const extractor = createExtractor({
      loaders: [
        fakeLoader({ name: "broken", fail: "corrupt xref" }),
        fakeLoader({ name: "working" }),
      ],
      strategies: [fakeStrategy()],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);

    expect(result.loader).toBe("working");
    // The failed loader is visible in the trail; the successful one is implied by
    // `loader`, so it does not clutter `attempts`.
    expect(result.attempts.map((a) => a.strategy)).toContain("broken");
    expect(result.attempts.find((a) => a.strategy === "broken")?.error).toContain("corrupt xref");
  });

  it("throws NoEligibleLoaderError when nothing accepts the media type", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader({ mimeTypes: ["image/png"] })],
      strategies: [fakeStrategy()],
    });

    await expect(extractor.extract(PDF_BYTES, Simple)).rejects.toThrowError(NoEligibleLoaderError);
    const error = await extractor.extract(PDF_BYTES, Simple).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoEligibleLoaderError);
    expect((error as NoEligibleLoaderError).code).toBe("NO_ELIGIBLE_LOADER");
    expect((error as NoEligibleLoaderError).mimeType).toBe("application/pdf");
  });

  it("throws LoadFailedError when every eligible loader throws", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader({ name: "a", fail: "boom" }), fakeLoader({ name: "b", fail: "bang" })],
      strategies: [fakeStrategy()],
    });
    const error = await extractor.extract(PDF_BYTES, Simple).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadFailedError);
    expect((error as LoadFailedError).attempts).toHaveLength(2);
  });

  it("honours a wildcard media type", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader({ mimeTypes: ["*/*"] })],
      strategies: [fakeStrategy()],
    });
    await expect(extractor.extract(PDF_BYTES, Simple)).resolves.toBeDefined();
  });
});

describe("eligibility", () => {
  it("never runs a strategy whose required facts do not hold", async () => {
    const ran = vi.fn();
    const extractor = createExtractor({
      // A scanned document: no text, so no TEXT_LAYER fact.
      loaders: [fakeLoader({ document: doc("", { lines: false }) })],
      strategies: [fakeStrategy({ requires: ["TEXT_LAYER"], onExtract: ran })],
    });

    const error = await extractor.extract(PDF_BYTES, Simple).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NoEligibleStrategyError);
    expect(ran).not.toHaveBeenCalled();
    // The features are on the error, which is what makes this diagnosable.
    expect((error as NoEligibleStrategyError).features.hasTextLayer).toBe(false);
    expect((error as NoEligibleStrategyError).gaps[0]?.missing).toEqual(["TEXT_LAYER"]);
  });

  it("reports GEOMETRY as absent when the loader cannot produce boxes", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader({ geometry: false, document: doc("plenty of text here to pass", { lines: false }) })],
      strategies: [fakeStrategy({ requires: ["GEOMETRY"] })],
    });
    await expect(extractor.extract(PDF_BYTES, Simple)).rejects.toThrowError(
      NoEligibleStrategyError,
    );
  });
});

describe("strategy fallback", () => {
  it("tries strategies in declaration order and the first that works wins", async () => {
    const order: string[] = [];
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ name: "first", fail: "nope", onExtract: () => order.push("first") }),
        fakeStrategy({ name: "second", onExtract: () => order.push("second") }),
        fakeStrategy({ name: "third", onExtract: () => order.push("third") }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);

    expect(order).toEqual(["first", "second"]);
    expect(result.method).toBe("second");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ strategy: "first", status: "failed" });
    expect(result.attempts[1]).toMatchObject({ strategy: "second", status: "ok" });
  });

  it("throws ExtractionFailedError with every attempt when all fail", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ name: "a", fail: "one" }),
        fakeStrategy({ name: "b", fail: "two" }),
      ],
    });

    const error = await extractor.extract(PDF_BYTES, Simple).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionFailedError);
    expect((error as ExtractionFailedError).attempts.map((a) => a.strategy)).toEqual(["a", "b"]);
  });

  it("treats a schema mismatch as a failed attempt and tries the next strategy", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ name: "wrong-shape", data: { value: 42 } }),
        fakeStrategy({ name: "right-shape", data: { value: "ok" } }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);

    expect(result.method).toBe("right-shape");
    expect(result.attempts[0]).toMatchObject({
      strategy: "wrong-shape",
      status: "failed",
      errorCode: "CONTRACT_VIOLATION",
    });
  });

  it("surfaces the contract violation, not the generic failure, when that is all that went wrong", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ data: { value: 42 } })],
    });

    const error = await extractor.extract(PDF_BYTES, Simple).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractViolationError);
    expect((error as ContractViolationError).issues[0]?.path).toBe("value");
  });

  it("lets a policy reorder eligible strategies", async () => {
    const reverse: RoutingPolicy = (_features, eligible) => [...eligible].reverse();
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ name: "a" }), fakeStrategy({ name: "b" })],
      policy: reverse,
    });
    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.method).toBe("b");
  });

  it("ignores a policy that invents a strategy it was not offered", async () => {
    const sneaky: RoutingPolicy = (_features, eligible) => [
      fakeStrategy({ name: "not-registered" }),
      ...eligible,
    ];
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ name: "real" })],
      policy: sneaky,
    });
    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.method).toBe("real");
  });

  it("restricts to `only`, in the order given", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ name: "a" }), fakeStrategy({ name: "b" })],
    });
    const result = await extractor.extract(PDF_BYTES, Simple, { only: ["b"] });
    expect(result.method).toBe("b");
    expect(result.attempts).toHaveLength(1);
  });
});

describe("abort and deadlines", () => {
  it("propagates a caller abort and suppresses fallback", async () => {
    const controller = new AbortController();
    const second = vi.fn();
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ name: "hangs", hang: true }),
        fakeStrategy({ name: "never-reached", onExtract: second }),
      ],
    });

    const promise = extractor.extract(PDF_BYTES, Simple, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow();
    // The caller cancelled; running the next strategy would be work they stopped.
    expect(second).not.toHaveBeenCalled();
  });

  it("treats OUR per-stage deadline as a retryable failure, so fallback still happens", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        fakeStrategy({ name: "too-slow", hang: true }),
        fakeStrategy({ name: "quick", data: { value: "made it" } }),
      ],
      stageTimeoutMs: 25,
    });

    const result = await extractor.extract(PDF_BYTES, Simple);

    expect(result.method).toBe("quick");
    expect(result.attempts[0]).toMatchObject({ strategy: "too-slow", errorCode: "TIMEOUT" });
  });
});

describe("classification", () => {
  it("is skipped entirely when no eligible strategy wants it", async () => {
    const classified = vi.fn();
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "none" })],
      classifiers: [
        {
          name: "counting",
          async classify() {
            classified();
            return null;
          },
        },
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(classified).not.toHaveBeenCalled();
    expect(result.classification).toBeUndefined();
  });

  it("runs when a strategy asks for a hint, and picks the most confident verdict", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "hint" })],
      classifiers: [
        fakeClassifier("weak", { classifier: "weak", name: "receipt", confidence: 0.4 }),
        fakeClassifier("strong", { classifier: "strong", name: "invoice", confidence: 0.9 }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.classification?.name).toBe("invoice");
    expect(result.classification?.signals).toHaveLength(2);
  });

  it("never fails a document because a classifier threw", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "hint" })],
      classifiers: [
        fakeClassifier("explodes", "throw"),
        fakeClassifier("fine", { classifier: "fine", name: "invoice", confidence: 0.8 }),
      ],
    });

    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.classification?.name).toBe("invoice");
    expect(result.classification?.signals.find((s) => s.classifier === "explodes")?.note).toContain(
      "threw",
    );
  });

  it("yields UNKNOWN when every classifier abstains", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "hint" })],
      classifiers: [fakeClassifier("abstains", null)],
    });
    const result = await extractor.extract(PDF_BYTES, Simple);
    expect(result.classification?.name).toBe("UNKNOWN");
  });

  it("will not route a strategy that REQUIRES a classification on an UNKNOWN verdict", async () => {
    const ran = vi.fn();
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "required", onExtract: ran })],
      classifiers: [fakeClassifier("abstains", null)],
    });

    await expect(extractor.extract(PDF_BYTES, Simple)).rejects.toThrowError(
      NoEligibleStrategyError,
    );
    expect(ran).not.toHaveBeenCalled();
  });

  it("prefers a most-voted verdict under the consensus strategy", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ needsClassification: "hint" })],
      classifiers: [
        fakeClassifier("a", { classifier: "a", name: "receipt", confidence: 0.5 }),
        fakeClassifier("b", { classifier: "b", name: "receipt", confidence: 0.5 }),
        fakeClassifier("c", { classifier: "c", name: "invoice", confidence: 0.95 }),
      ],
      classify: { strategy: "consensus" },
    });

    const result = await extractor.extract(PDF_BYTES, Simple);
    // Two votes for receipt beat one louder vote for invoice.
    expect(result.classification?.name).toBe("receipt");
  });
});

describe("wiring errors", () => {
  it("rejects two components sharing a name rather than shadowing one", () => {
    expect(() =>
      createExtractor({
        loaders: [fakeLoader({ name: "dup" }), fakeLoader({ name: "dup" })],
      }),
    ).toThrowError(DuplicateComponentError);
  });

  it("requires at least one loader", () => {
    expect(() => createExtractor({ loaders: [] })).toThrowError(TypeError);
  });
});

describe("dispose", () => {
  it("disposes every component exactly once, even when called twice", async () => {
    const loaderDispose = vi.fn();
    const strategyDispose = vi.fn();
    const extractor = createExtractor({
      loaders: [fakeLoader({ onDispose: loaderDispose })],
      strategies: [fakeStrategy({ onDispose: strategyDispose })],
    });

    await extractor.dispose();
    await extractor.dispose();

    expect(loaderDispose).toHaveBeenCalledTimes(1);
    expect(strategyDispose).toHaveBeenCalledTimes(1);
  });

  it("surfaces every failure, so one broken teardown cannot hide another", async () => {
    const extractor = createExtractor({
      loaders: [
        fakeLoader({
          name: "a",
          onDispose: () => {
            throw new Error("a failed");
          },
        }),
        fakeLoader({
          name: "b",
          onDispose: () => {
            throw new Error("b failed");
          },
        }),
      ],
    });

    const error = await extractor.dispose().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
  });
});

describe("safeExtract and extractBatch", () => {
  it("safeExtract returns the error instead of throwing", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ fail: "nope" })],
    });

    const outcome = await extractor.safeExtract(PDF_BYTES, Simple);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBeInstanceOf(ExtractionFailedError);
  });

  it("safeExtract narrows to a typed result on success", async () => {
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [fakeStrategy({ data: { value: "ok" } })],
    });

    const outcome = await extractor.safeExtract(PDF_BYTES, Simple);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expectTypeOf(outcome.result.data).toEqualTypeOf<{ value: string }>();
      expect(outcome.result.data.value).toBe("ok");
    }
  });

  it("extractBatch yields every document, and one failure does not lose the rest", async () => {
    let call = 0;
    const extractor = createExtractor({
      loaders: [fakeLoader()],
      strategies: [
        {
          name: "every-other-one-fails",
          async extract() {
            call += 1;
            if (call === 2) throw new Error("second document is bad");
            return { data: { value: `doc-${call}` } };
          },
        },
      ],
    });

    const items = [];
    for await (const item of extractor.extractBatch(
      [PDF_BYTES, PDF_BYTES, PDF_BYTES],
      Simple,
      { concurrency: 1 },
    )) {
      items.push(item);
    }

    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.outcome.ok)).toHaveLength(2);
    expect(items.filter((i) => !i.outcome.ok)).toHaveLength(1);
    expect(items.map((i) => i.index).sort()).toEqual([0, 1, 2]);
  });
});
