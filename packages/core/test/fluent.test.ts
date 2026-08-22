/**
 * The fluent `Extractor` — building a pipeline one decision at a time.
 *
 * The chained form and the options-object form must produce the SAME pipeline;
 * anything else and the two ways to build one are two behaviours to learn.
 */

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  DuplicateComponentError,
  Extractor,
  createExtractor,
  defineClassification,
  type ModelBackend,
} from "../src/index.js";
import { PDF_BYTES, doc, fakeClassifier, fakeLoader, fakeStrategy } from "./fakes.js";

const Simple = z.object({ value: z.string() });

describe("building", () => {
  it("chains, and each call returns the same extractor", () => {
    const extractor = new Extractor();
    expect(extractor.loadDocumentLoader(fakeLoader())).toBe(extractor);
    expect(extractor.loadStrategy(fakeStrategy())).toBe(extractor);
  });

  it("produces the same components either way", () => {
    const loader = fakeLoader();
    const strategy = fakeStrategy();

    const chained = new Extractor().loadDocumentLoader(loader).loadStrategy(strategy);
    const declared = new Extractor({ loaders: [loader], strategies: [strategy] });

    expect(chained.components).toEqual(declared.components);
  });

  it("takes several components in one call", () => {
    const extractor = new Extractor().loadDocumentLoader(
      fakeLoader({ name: "a" }),
      fakeLoader({ name: "b", mimeTypes: ["image/png"] }),
    );
    expect(extractor.components.loaders.map((l) => l.name)).toEqual(["a", "b"]);
  });

  it("exposes components as a copy, so the wiring cannot be mutated from outside", () => {
    const extractor = new Extractor().loadDocumentLoader(fakeLoader());
    const stolen = extractor.components.loaders as ReturnType<typeof fakeLoader>[];
    stolen.push(fakeLoader({ name: "smuggled" }));
    expect(extractor.components.loaders).toHaveLength(1);
  });

  /** Two components under one name would silently shadow. */
  it("rejects a duplicate name at the call that introduces it", () => {
    const extractor = new Extractor().loadStrategy(fakeStrategy({ name: "dup" }));
    expect(() => extractor.loadStrategy(fakeStrategy({ name: "dup" }))).toThrowError(
      DuplicateComponentError,
    );
  });

  it("rejects duplicates in the options form too", () => {
    expect(
      () =>
        new Extractor({
          loaders: [fakeLoader({ name: "dup" }), fakeLoader({ name: "dup" })],
        }),
    ).toThrowError(DuplicateComponentError);
  });

  it("says what is missing when nothing can read the document", async () => {
    await expect(new Extractor().extract(PDF_BYTES, Simple)).rejects.toThrowError(
      /no loader/i,
    );
  });

  it("createExtractor still insists on a loader up front", () => {
    expect(() => createExtractor({ loaders: [] })).toThrowError(/at least one loader/);
  });

  it("createExtractor returns an Extractor", () => {
    const extractor = createExtractor({ loaders: [fakeLoader()] });
    expect(extractor).toBeInstanceOf(Extractor);
  });
});

describe("loadLlm", () => {
  const strategy = fakeStrategy({ name: "model-text", data: { value: "from-model" } });
  const visionStrategy = fakeStrategy({ name: "model-vision", requires: ["RENDERABLE_PAGES"] });
  const classifier = fakeClassifier("model-classifier", {
    classifier: "model-classifier",
    name: "invoice",
    confidence: 0.9,
  });

  const backend = (over: Partial<ModelBackend> = {}): ModelBackend => ({
    id: "test/model",
    extraction: () => strategy,
    vision: () => visionStrategy,
    classifier: () => classifier,
    ...over,
  });

  it("registers the extraction strategy", () => {
    const extractor = new Extractor().loadLlm(backend());
    expect(extractor.components.strategies.map((s) => s.name)).toEqual(["model-text"]);
  });

  it("registers vision and the classifier when asked", () => {
    const extractor = new Extractor().loadLlm(backend(), { vision: true, classify: true });
    expect(extractor.components.strategies.map((s) => s.name)).toEqual([
      "model-text",
      "model-vision",
    ]);
    expect(extractor.components.classifiers.map((c) => c.name)).toEqual(["model-classifier"]);
  });

  /**
   * The point of the capability being optional: a backend with no vision fails at
   * the wiring line, naming itself, rather than on the first scanned page.
   */
  it("refuses { vision: true } on a backend that has none", () => {
    const { vision: _omitted, ...withoutVision } = backend();
    expect(() => new Extractor().loadLlm(withoutVision as ModelBackend, { vision: true })).toThrowError(
      /test\/model.*no vision/,
    );
  });

  it("refuses { classify: true } on a backend that has no classifier", () => {
    const { classifier: _omitted, ...withoutClassifier } = backend();
    expect(() =>
      new Extractor().loadLlm(withoutClassifier as ModelBackend, { classify: true }),
    ).toThrowError(/test\/model.*no classifier/);
  });

  it("runs end to end", async () => {
    const result = await new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadLlm(backend())
      .extract(PDF_BYTES, Simple);
    expect(result.data.value).toBe("from-model");
    expect(result.method).toBe("model-text");
  });
});

describe("extractData", () => {
  const build = (): Extractor =>
    new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadStrategy(fakeStrategy({ data: { value: "just-this" } }));

  it("returns the data alone, typed", async () => {
    const data = await build().extractData(PDF_BYTES, Simple);
    expectTypeOf(data).toEqualTypeOf<{ value: string }>();
    expect(data).toEqual({ value: "just-this" });
  });

  it("throws like extract does", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadStrategy(fakeStrategy({ fail: "nope" }));
    await expect(extractor.extractData(PDF_BYTES, Simple)).rejects.toThrow();
  });

  it("extractResult is extract", async () => {
    const result = await build().extractResult(PDF_BYTES, Simple);
    expect(result.data.value).toBe("just-this");
    expect(result.method).toBeDefined();
  });
});

describe("classify", () => {
  const invoice = defineClassification({
    name: "invoice",
    description: "an invoice",
    schema: Simple,
  });
  const receipt = defineClassification({
    name: "receipt",
    description: "a receipt",
    schema: Simple,
  });

  const build = (verdict: string, confidence = 0.9): Extractor =>
    new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(
        fakeClassifier("c", { classifier: "c", name: verdict, confidence }),
      );

  it("returns the matched classification alongside the name", async () => {
    const response = await build("invoice").classify(PDF_BYTES, [invoice, receipt]);
    expect(response.name).toBe("invoice");
    expect(response.classification).toBe(invoice);
    expect(response.confidence).toBe(0.9);
  });

  it("narrows `name` to the candidates, so a switch is exhaustive", async () => {
    const response = await build("invoice").classify(PDF_BYTES, [invoice, receipt]);
    expectTypeOf(response.name).toEqualTypeOf<"invoice" | "receipt" | "UNKNOWN">();
    expectTypeOf(response.classification).toEqualTypeOf<
      typeof invoice | typeof receipt | undefined
    >();
  });

  it("reports UNKNOWN with no classification when nothing matched", async () => {
    const response = await build("something-else").classify(PDF_BYTES, [invoice, receipt]);
    expect(response.name).toBe("UNKNOWN");
    expect(response.classification).toBeUndefined();
  });

  it("keeps every classifier's signal, including abstentions", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(
        fakeClassifier("a", { classifier: "a", name: "invoice", confidence: 0.8 }),
        fakeClassifier("b", null),
      );
    const response = await extractor.classify(PDF_BYTES, [invoice]);
    expect(response.signals.map((s) => s.classifier)).toEqual(["a"]);
  });

  it("falls back to the wired classifications", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifications(invoice, receipt)
      .loadClassifier(fakeClassifier("c", { classifier: "c", name: "receipt", confidence: 1 }));
    const response = await extractor.classify(PDF_BYTES);
    expect(response.name).toBe("receipt");
  });
});

describe("classifyTree", () => {
  const financial = defineClassification({
    name: "financial",
    description: "money",
    schema: Simple,
  });
  const identity = defineClassification({ name: "identity", description: "id", schema: Simple });
  const invoice = defineClassification({
    name: "invoice",
    description: "an invoice",
    schema: Simple,
  });
  const receipt = defineClassification({
    name: "receipt",
    description: "a receipt",
    schema: Simple,
  });

  /** Answers with whichever candidate it was told to prefer, level by level. */
  const scripted = (answers: readonly string[]): Extractor => {
    let call = 0;
    return new Extractor().loadDocumentLoader(fakeLoader()).loadClassifier({
      name: "scripted",
      async classify() {
        const name = answers[call] ?? "UNKNOWN";
        call += 1;
        return { classifier: "scripted", name, confidence: 0.9 };
      },
    });
  };

  const tree = {
    nodes: [
      {
        classification: financial,
        children: [{ classification: invoice }, { classification: receipt }],
      },
      { classification: identity },
    ],
  };

  it("descends to the leaf, recording every verdict on the way", async () => {
    const { leaf, path } = await scripted(["financial", "receipt"]).classifyTree(PDF_BYTES, tree);
    expect(path.map((p) => p.name)).toEqual(["financial", "receipt"]);
    expect(leaf.name).toBe("receipt");
    expect(leaf.classification).toBe(receipt);
  });

  it("stops at a node with no children", async () => {
    const { leaf, path } = await scripted(["identity"]).classifyTree(PDF_BYTES, tree);
    expect(path).toHaveLength(1);
    expect(leaf.name).toBe("identity");
  });

  it("stops when a level cannot be decided", async () => {
    const { leaf, path } = await scripted(["nothing-matches"]).classifyTree(PDF_BYTES, tree);
    expect(path).toHaveLength(1);
    expect(leaf.name).toBe("UNKNOWN");
  });

  it("flattens a tree depth-first", () => {
    expect(Extractor.flatten(tree).map((c) => c.name)).toEqual([
      "financial",
      "invoice",
      "receipt",
      "identity",
    ]);
  });
});

describe("extractBatch", () => {
  it("yields every document, failures included", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadStrategy(fakeStrategy({ data: { value: "ok" } }));

    const items = [];
    for await (const item of extractor.extractBatch([PDF_BYTES, PDF_BYTES], Simple)) {
      items.push(item);
    }
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.outcome.ok)).toBe(true);
  });

  it("does not lose the good documents when one is bad", async () => {
    let call = 0;
    const extractor = new Extractor().loadDocumentLoader(fakeLoader()).loadStrategy({
      name: "flaky",
      async extract() {
        call += 1;
        if (call === 1) throw new Error("first one is bad");
        return { data: { value: "ok" } };
      },
    });

    const outcomes = [];
    for await (const item of extractor.extractBatch([PDF_BYTES, PDF_BYTES], Simple, {
      concurrency: 1,
    })) {
      outcomes.push(item.outcome.ok);
    }
    expect(outcomes).toEqual([false, true]);
  });
});

describe("dispose", () => {
  it("disposes every component exactly once, however often it is called", async () => {
    const onDispose = vi.fn();
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader({ onDispose }))
      .loadStrategy(fakeStrategy({ onDispose }));

    await Promise.all([extractor.dispose(), extractor.dispose()]);
    await extractor.dispose();
    expect(onDispose).toHaveBeenCalledTimes(2); // one loader + one strategy
  });
});

describe("a pre-loaded source", () => {
  const loaded = doc("PRE-LOADED, and comfortably past the fifty character text-layer floor");

  it("skips the load stage entirely", async () => {
    const load = vi.fn();
    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "never-called",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => {
          load();
          return loaded;
        },
      })
      .loadStrategy(fakeStrategy({ data: { value: "ok" } }));

    const result = await extractor.extract({ loaded }, Simple);
    expect(load).not.toHaveBeenCalled();
    expect(result.loader).toBe(loaded.loader);
  });

  it("classifies without a loader too", async () => {
    const invoice = defineClassification({
      name: "invoice",
      description: "an invoice",
      schema: Simple,
    });
    const extractor = new Extractor().loadClassifier(
      fakeClassifier("c", { classifier: "c", name: "invoice", confidence: 1 }),
    );
    const response = await extractor.classify({ loaded }, [invoice]);
    expect(response.name).toBe("invoice");
  });
});

describe("a verdict must name a candidate", () => {
  const invoice = defineClassification({
    name: "invoice",
    description: "an invoice",
    schema: Simple,
  });

  it("matches case-insensitively, and reports the CANDIDATE's spelling", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(fakeClassifier("c", { classifier: "c", name: "Invoice", confidence: 1 }));
    const response = await extractor.classify(PDF_BYTES, [invoice]);
    expect(response.name).toBe("invoice");
    expect(response.classification).toBe(invoice);
  });

  /**
   * The type says `name` is one of the candidates or UNKNOWN. A classifier that
   * invents a third answer must not be able to make that false.
   */
  it("discards an invented name, but keeps its signal visible", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(
        fakeClassifier("c", { classifier: "c", name: "bill-of-lading", confidence: 1 }),
      );
    const response = await extractor.classify(PDF_BYTES, [invoice]);
    expect(response.name).toBe("UNKNOWN");
    expect(response.signals[0]?.name).toBe("bill-of-lading");
  });

  it("lets a real candidate win over an invented one", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(
        fakeClassifier("a", { classifier: "a", name: "bill-of-lading", confidence: 1 }),
        fakeClassifier("b", { classifier: "b", name: "invoice", confidence: 0.4 }),
      );
    const response = await extractor.classify(PDF_BYTES, [invoice]);
    expect(response.name).toBe("invoice");
  });

  it("free-labels when there are no candidates to check against", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadClassifier(fakeClassifier("c", { classifier: "c", name: "anything", confidence: 1 }));
    const response = await extractor.classify(PDF_BYTES, []);
    expect(response.name).toBe("anything");
  });
});
