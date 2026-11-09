/**
 * `Process` — extracting a bundle that holds more than one document.
 *
 * Two claims to hold down. The bundle is read ONCE, however many documents come out
 * of it. And the result is a discriminated union, so narrowing on `name` narrows
 * `data` — which is the whole reason the classification list is captured in the type
 * rather than passed as a bare array.
 */

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  Extractor,
  Process,
  SplitFailedError,
  SplittingStrategy,
  UnclassifiedGroupError,
  defineClassification,
  errorCodeOf,
  type DocumentLoader,
  type ProcessExtractOptions,
} from "../../src/core/index.js";
import { PDF_BYTES, doc, fakeLoader, fakeSplitter, fakeStrategy, multiPageDoc, renderableDoc } from "./fakes.js";

const Invoice = z.object({ invoiceNumber: z.string() });
const Licence = z.object({ licenceNumber: z.string() });

const invoice = defineClassification({
  name: "invoice",
  description: "an invoice",
  schema: Invoice,
});
const licence = defineClassification({
  name: "licence",
  description: "a driving licence",
  schema: Licence,
});

/** Answers with whichever field the page group's contract asks for. */
const echoStrategy = fakeStrategy({
  name: "echo",
  data: { invoiceNumber: "INV-1", licenceNumber: "DL-9" },
});

const bundle = multiPageDoc([
  "INVOICE page one with quite a lot of text on it indeed",
  "invoice page two continues the table from page one",
  "DRIVING LICENCE for someone, with more than fifty characters of text",
]);

function build(loader?: DocumentLoader): {
  process: Process;
  extractor: Extractor;
  load: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn(async () => bundle);
  const documentLoader: DocumentLoader = loader ?? {
    name: "counting",
    capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
    load,
  };
  const extractor = new Extractor()
    .loadDocumentLoader(documentLoader)
    .loadStrategy(echoStrategy);
  const process = new Process().loadExtractor(extractor);
  return { process, extractor, load };
}

describe("splitting and extracting", () => {
  it("cuts a bundle into its documents and reports the pages of each", async () => {
    const { process } = build();
    const results = await process
      .loadSplitter(
        fakeSplitter({
          eager: [
            { pages: [1, 2], classification: "invoice" },
            { pages: [3], classification: "licence" },
          ],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice, licence], SplittingStrategy.EAGER)
      .extract();

    expect(results.map((r) => [r.name, r.pages])).toEqual([
      ["invoice", [1, 2]],
      ["licence", [3]],
    ]);
  });

  /** The whole reason `Process` exists instead of three `extract` calls. */
  it("reads the bundle exactly once, however many documents come out", async () => {
    const { process, load } = build();
    await process
      .loadSplitter(
        fakeSplitter({
          eager: [
            { pages: [1], classification: "invoice" },
            { pages: [2], classification: "invoice" },
            { pages: [3], classification: "licence" },
          ],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .extract();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands each document only its own pages", async () => {
    const seen: string[] = [];
    const spy = fakeStrategy({
      name: "spy",
      data: { invoiceNumber: "x", licenceNumber: "y" },
      onExtract: (ctx) => seen.push(ctx.document.pages.map((p) => p.pageNumber).join(",")),
    });

    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "l",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => bundle,
      })
      .loadStrategy(spy);

    await new Process()
      .loadExtractor(extractor)
      .loadSplitter(
        fakeSplitter({
          eager: [
            { pages: [1, 2], classification: "invoice" },
            { pages: [3], classification: "licence" },
          ],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .extract({ concurrency: 1 });

    expect(seen).toEqual(["1,2", "3"]);
  });

  it("keeps the ORIGINAL page numbers, so a report can point at the scan", async () => {
    let numbers: number[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "l",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => bundle,
      })
      .loadStrategy(
        fakeStrategy({
          data: { licenceNumber: "DL-9" },
          onExtract: (ctx) => {
            numbers = ctx.document.pages.map((p) => p.pageNumber);
          },
        }),
      );

    await new Process()
      .loadExtractor(extractor)
      .loadSplitter(fakeSplitter({ eager: [
        { pages: [1, 2], classification: "UNKNOWN" },
        { pages: [3], classification: "licence" },
      ] }))
      .loadFile(PDF_BYTES)
      .split([licence])
      .extract({ onUnclassified: "skip" });

    expect(numbers).toEqual([3]);
  });

  it("takes options built from a prototype or a class as options, not as a source", async () => {
    class Settings { readonly onUnclassified = "skip" as const; }
    const inherited: ProcessExtractOptions = Object.create({ onUnclassified: "skip" });
    const extracted: number[][] = [];
    for (const options of [new Settings(), inherited]) {
      const extractor = new Extractor()
        .loadDocumentLoader(fakeLoader({ document: multiPageDoc(["a", "b", "c"]) }))
        .loadStrategy(fakeStrategy({ data: { licenceNumber: "DL-9" }, onExtract: (ctx) => { extracted.push(ctx.document.pages.map((p) => p.pageNumber)); } }));
      const outcome = await new Process()
        .loadExtractor(extractor)
        .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2], classification: "UNKNOWN" }, { pages: [3], classification: "licence" }] }))
        .loadFile(PDF_BYTES)
        .split([licence])
        .extract(options)
        .then((results) => results.length, (error: unknown) => errorCodeOf(error));
      expect(outcome).toBe(1);
    }
    expect(extracted).toEqual([[3], [3]]);
  });

  it("insists on a planned split, rather than guessing what the kinds are", async () => {
    const { process } = build();
    await expect(process.loadFile(PDF_BYTES).extract()).rejects.toThrowError(SplitFailedError);
  });

  it("uses the LAZY path when asked", async () => {
    const { process } = build();
    const results = await process
      .loadSplitter(fakeSplitter({ seams: [true, false], classify: (n) => (n === 3 ? "licence" : "invoice") }))
      .loadFile(PDF_BYTES)
      .split([invoice, licence], SplittingStrategy.LAZY)
      .extract();

    expect(results.map((r) => [r.name, r.pages])).toEqual([
      ["invoice", [1, 2]],
      ["licence", [3]],
    ]);
  });
});

describe("typing", () => {
  it("narrows `data` when you narrow `name`", async () => {
    const { process } = build();
    const results = await process
      .loadSplitter(
        fakeSplitter({
          eager: [
            { pages: [1, 2], classification: "invoice" },
            { pages: [3], classification: "licence" },
          ],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .extract();

    for (const document of results) {
      if (document.name === "invoice") {
        expectTypeOf(document.data).toEqualTypeOf<{ invoiceNumber: string }>();
      } else {
        expectTypeOf(document.name).toEqualTypeOf<"licence">();
        expectTypeOf(document.data).toEqualTypeOf<{ licenceNumber: string }>();
      }
    }
    expect(results).toHaveLength(2);
  });

  it("types `data` from `extractionContract` when the kinds differ", async () => {
    const Full = z.object({ invoiceNumber: z.string(), total: z.number() });
    const cheapToRecognise = defineClassification({
      name: "invoice",
      description: "an invoice",
      schema: Invoice,
      extractionContract: Full,
    });

    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "l",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => bundle,
      })
      .loadStrategy(fakeStrategy({ data: { invoiceNumber: "INV-1", total: 10 } }));

    const results = await new Process()
      .loadExtractor(extractor)
      .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "invoice" }] }))
      .loadFile(PDF_BYTES)
      .split([cheapToRecognise])
      .extract();

    const first = results[0];
    expectTypeOf(first!.data).toEqualTypeOf<{ invoiceNumber: string; total: number }>();
    expect(first?.data.total).toBe(10);
  });
});

describe("per-classification extractors", () => {
  it("uses the classification's own extractor when it has one", async () => {
    const cheap = new Extractor()
      .loadDocumentLoader(fakeLoader())
      .loadStrategy(fakeStrategy({ name: "cheap", data: { licenceNumber: "FROM-CHEAP" } }));

    const licenceOwnExtractor = defineClassification({
      name: "licence",
      description: "a driving licence",
      schema: Licence,
      extractor: cheap,
    });

    const { process } = build();
    const results = await process
      .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "licence" }] }))
      .loadFile(PDF_BYTES)
      .split([licenceOwnExtractor])
      .extract();

    expect(results[0]?.result.method).toBe("cheap");
    expect(results[0]?.data).toEqual({ licenceNumber: "FROM-CHEAP" });
  });

  it("says which classification has no extractor", async () => {
    const orphan = defineClassification({
      name: "licence",
      description: "a driving licence",
      schema: Licence,
    });

    await expect(
      new Process()
        .loadDocumentLoader(fakeLoader({ document: bundle }))
        .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "licence" }] }))
        .loadFile(PDF_BYTES)
        .split([orphan])
        .extract(),
    ).rejects.toThrowError(/No extractor for "licence"/);
  });
});

describe("groups nobody claimed", () => {
  const unknownGroup = fakeSplitter({
    eager: [
      { pages: [1, 2], classification: "invoice" },
      { pages: [3], classification: "something-else" },
    ],
  });

  /** Pages that fell out of a bundle are the ones nobody notices are missing. */
  it("throws, naming the pages and what they were called", async () => {
    const { process } = build();
    const failure = await process
      .loadSplitter(unknownGroup)
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .extract()
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UnclassifiedGroupError);
    expect((failure as Error).message).toMatch(/Pages 3/);
    expect((failure as Error).message).toMatch(/something-else/);
  });

  it("drops them when told to, and keeps the rest", async () => {
    const { process } = build();
    const results = await process
      .loadSplitter(unknownGroup)
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .extract({ onUnclassified: "skip" });

    expect(results.map((r) => r.name)).toEqual(["invoice"]);
  });
});

describe("wiring failures", () => {
  it("says so when there is no file", async () => {
    await expect(build().process.split([invoice]).extract()).rejects.toThrowError(/no file/i);
  });

  it("says so when a split is planned with no splitter", async () => {
    const { process } = build();
    await expect(
      process.loadFile(PDF_BYTES).split([invoice]).extract(),
    ).rejects.toThrowError(/no splitter/i);
  });

  it("says so when there is no loader anywhere", async () => {
    await expect(
      new Process().loadFile(PDF_BYTES).split([invoice]).extract(),
    ).rejects.toThrowError(/no loader/i);
  });

  /**
   * An ImageSplitter handed a text-only bundle must fail at the wiring seam, not
   * forty pages in.
   */
  it("refuses a splitter whose required facts the document lacks", async () => {
    const { process } = build();
    const failure = await process
      .loadSplitter(fakeSplitter({ requires: ["RENDERABLE_PAGES"] }))
      .loadFile(PDF_BYTES)
      .split([invoice])
      .extract()
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(SplitFailedError);
    expect((failure as Error).message).toMatch(/RENDERABLE_PAGES/);
  });

  it("accepts it once the pages can render", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "renderable",
        capabilities: { text: true, geometry: false, images: true, mimeTypes: ["*/*"] },
        load: async () => renderableDoc(["one", "two"]),
      })
      .loadStrategy(fakeStrategy({ data: { invoiceNumber: "INV-1" } }));

    const results = await new Process()
      .loadExtractor(extractor)
      .loadSplitter(
        fakeSplitter({
          requires: ["RENDERABLE_PAGES"],
          eager: [{ pages: [1, 2], classification: "invoice" }],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice])
      .extract();

    expect(results).toHaveLength(1);
  });
});

describe("the split report", () => {
  it("records the splitter, the strategy and the groups", async () => {
    const { process } = build();
    await process
      .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "invoice" }] }))
      .loadFile(PDF_BYTES)
      .split([invoice], SplittingStrategy.EAGER)
      .extract();

    expect(process.lastSplit).toMatchObject({
      splitter: "fake-splitter",
      strategy: "eager",
      groups: [{ pages: [1, 2, 3], classification: "invoice" }],
    });
  });

  /** Deciding where a bundle divides is not free, and a cost report that omits it is wrong. */
  it("accounts for what deciding the cut cost", async () => {
    const { process } = build();
    await process
      .loadSplitter(fakeSplitter({ seams: [true, true], tokensPerCall: 100 }))
      .loadFile(PDF_BYTES)
      .split([invoice], SplittingStrategy.LAZY)
      .extract();

    // Two seams for three pages.
    expect(process.lastSplit?.usage.inputTokens).toBe(200);
    expect(process.lastSplit?.usage.outputTokens).toBe(2);
  });

  it("is zero when the splitter used no model", async () => {
    const { process } = build();
    await process
      .loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "invoice" }] }))
      .loadFile(PDF_BYTES)
      .split([invoice])
      .extract();
    expect(process.lastSplit?.usage.totalTokens).toBe(0);
  });

  it("splitOnly cuts without extracting anything", async () => {
    const extract = vi.fn();
    const extractor = new Extractor()
      .loadDocumentLoader({
        name: "l",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => bundle,
      })
      .loadStrategy({ name: "never", extract: extract as never });

    const report = await new Process()
      .loadExtractor(extractor)
      .loadSplitter(
        fakeSplitter({
          eager: [
            { pages: [1, 2], classification: "invoice" },
            { pages: [3], classification: "licence" },
          ],
        }),
      )
      .loadFile(PDF_BYTES)
      .split([invoice, licence])
      .splitOnly();

    expect(extract).not.toHaveBeenCalled();
    expect(report.groups).toHaveLength(2);
  });
});

describe("a bundle that turned out to be one document", () => {
  const single = multiPageDoc(["The only page, with well over fifty characters of text on it"]);

  const onePageProcess = (extractor: Extractor): Process =>
    new Process().loadExtractor(extractor).loadFile(PDF_BYTES);

  const withDoc = (strategy = fakeStrategy({ data: { invoiceNumber: "INV-1" } })): Extractor =>
    new Extractor()
      .loadDocumentLoader({
        name: "l",
        capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
        load: async () => single,
      })
      .loadStrategy(strategy);

  /** A one-page file has no seams, so requiring a splitter for it is wiring noise. */
  it("needs no splitter at all", async () => {
    const results = await onePageProcess(withDoc()).split([invoice]).extract();
    expect(results.map((r) => [r.name, r.pages])).toEqual([["invoice", [1]]]);
  });

  it("never calls the splitter it was given", async () => {
    const onSeam = vi.fn();
    await onePageProcess(withDoc())
      .loadSplitter(fakeSplitter({ onSeam }))
      .split([invoice])
      .extract();
    expect(onSeam).not.toHaveBeenCalled();
  });

  it("classifies it when there is more than one candidate", async () => {
    const extractor = withDoc(
      fakeStrategy({ data: { invoiceNumber: "INV-1", licenceNumber: "DL-9" } }),
    ).loadClassifier({
      name: "picker",
      async classify() {
        return { classifier: "picker", name: "licence", confidence: 0.9 };
      },
    });

    const results = await onePageProcess(extractor).split([invoice, licence]).extract();
    expect(results.map((r) => r.name)).toEqual(["licence"]);
  });

  it("reports it as unclassified when nothing can name it", async () => {
    await expect(
      onePageProcess(withDoc()).split([invoice, licence]).extract(),
    ).rejects.toThrowError(UnclassifiedGroupError);
  });
});

const countingLoader = (load: DocumentLoader["load"], facts?: readonly string[]): DocumentLoader => ({
  name: "counting",
  capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"], ...(facts === undefined ? {} : { facts }) },
  load,
});

describe("the splitter's verdict", () => {
  it.each([undefined, "none", "hint"] as const)("retains the split classification when a strategy requests %s classification", async (needsClassification) => {
    const extractor = new Extractor({
      loaders: [fakeLoader()],
      strategies: [{
        name: "contrary",
        ...(needsClassification === undefined ? {} : { needsClassification }),
        async extract() {
          return {
            data: { invoiceNumber: "INV-1" },
            classification: { name: "licence", confidence: 1, signals: [] },
          };
        },
      }],
    });
    const results = await new Process().loadExtractor(extractor).split([invoice])
      .extract({ loaded: doc("Invoice INV-1") });
    expect(results.map((result) => [result.name, result.result.classification?.name])).toEqual([["invoice", "invoice"]]);
  });

  it("is the classification each document is extracted under, with no second classifier call", async () => {
    const classify = vi.fn(async () => ({ classifier: "contrary", name: "licence", confidence: 1 }));
    const seen: (string | undefined)[] = [];
    const extractor = new Extractor({ classifications: [invoice, licence] })
      .loadDocumentLoader(countingLoader(async () => bundle))
      .loadClassifier({ name: "contrary", classify })
      .loadStrategy(fakeStrategy({
        needsClassification: "hint",
        data: { invoiceNumber: "INV-1", licenceNumber: "DL-9" },
        onExtract: (ctx) => seen.push(ctx.classification?.name),
      }));
    const results = await new Process().loadExtractor(extractor)
      .loadSplitter(fakeSplitter({ eager: [
        { pages: [1, 2], classification: "invoice" },
        { pages: [3], classification: "licence" },
      ] }))
      .loadFile(PDF_BYTES).split([invoice, licence]).extract({ concurrency: 1 });

    expect({
      classifierCalls: classify.mock.calls.length,
      seen,
      reported: results.map((r) => r.result.classification),
    }).toEqual({
      classifierCalls: 0,
      seen: ["invoice", "licence"],
      reported: [
        { name: "invoice", confidence: 1, signals: [] },
        { name: "licence", confidence: 1, signals: [] },
      ],
    });
  });
});

describe("a failing document", () => {
  it("cancels the documents still running and starts no more", async () => {
    const started: number[] = [];
    const aborted: number[] = [];
    const extractor = new Extractor().loadDocumentLoader(countingLoader(async () => multiPageDoc(["a", "b", "c", "d"])))
      .loadStrategy({
        name: "first-fails",
        async extract(ctx) {
          const page = ctx.document.pages[0]?.pageNumber ?? 0;
          started.push(page);
          if (page === 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error("page one failed");
          }
          return new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => {
            aborted.push(page);
            reject(ctx.signal.reason);
          }, { once: true }));
        },
      });
    const failure = await new Process().loadExtractor(extractor)
      .loadSplitter(fakeSplitter({ eager: [1, 2, 3, 4].map((page) => ({ pages: [page], classification: "invoice" })) }))
      .loadFile(PDF_BYTES).split([invoice]).extract({ concurrency: 2 })
      .catch((error: unknown) => errorCodeOf(error));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect({ failure, started, aborted }).toEqual({
      failure: "EXTRACTION_FAILED",
      started: [1, 2],
      aborted: [2],
    });
  });
});

describe("loader facts", () => {
  const signed = defineClassification({ name: "signed", description: "a signed form", schema: z.object({ ok: z.boolean() }) });
  const needsSignature = fakeStrategy({ name: "needs-signature", requires: ["SIGNED"], data: { ok: true } });

  it("keep a strategy that requires a loader's custom fact eligible", async () => {
    const extractor = new Extractor()
      .loadDocumentLoader(countingLoader(async () => multiPageDoc(["Signed form with more than fifty characters of text"]), ["SIGNED"]))
      .loadStrategy(needsSignature);
    const results = await new Process().loadExtractor(extractor).loadFile(PDF_BYTES).split([signed]).extract();
    expect(results.map((r) => [r.name, r.data])).toEqual([["signed", { ok: true }]]);
  });

  it("keep the facts a loaded source carries", async () => {
    const extractor = new Extractor().loadDocumentLoader(fakeLoader()).loadStrategy(needsSignature);
    const results = await new Process().loadExtractor(extractor)
      .loadFile({ loaded: multiPageDoc(["Signed form with more than fifty characters of text"]), facts: ["SIGNED"] })
      .split([signed]).extract();
    expect(results.map((r) => [r.name, r.data])).toEqual([["signed", { ok: true }]]);
  });
});

describe("Process options", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects concurrency %s before reading the file", async (concurrency) => {
    const { process, load } = build();
    await expect(process.loadSplitter(fakeSplitter({ eager: [{ pages: [1, 2, 3], classification: "invoice" }] }))
      .loadFile(PDF_BYTES).split([invoice]).extract({ concurrency }))
      .rejects.toThrow("concurrency must be a positive integer");
    expect(load).not.toHaveBeenCalled();
  });
});

describe("one configured Process, several files", () => {
  const read: number[] = [];
  const configured = (): Process<readonly [typeof invoice]> => new Process()
    .loadExtractor(new Extractor()
      .loadDocumentLoader(countingLoader(async (raw) => {
        read.push(raw.bytes[0] ?? 0);
        return multiPageDoc([`Document number ${raw.bytes[0]} with more than fifty characters of text`]);
      }))
      .loadStrategy({
        name: "number",
        async extract(ctx) { return { data: { invoiceNumber: /number (\d+)/.exec(ctx.document.text)?.[1] ?? "" } }; },
      }))
    .split([invoice]);

  it("extracts each source passed to extract, concurrently", async () => {
    const process = configured();
    const [first, second] = await Promise.all([
      process.extract(new Uint8Array([7])),
      process.extract(new Uint8Array([9]), { concurrency: 1 }),
    ]);
    expect([first?.[0]?.data, second?.[0]?.data]).toEqual([{ invoiceNumber: "7" }, { invoiceNumber: "9" }]);
  });

  it("splits the source passed to splitOnly and keeps the loaded file for extract", async () => {
    read.length = 0;
    const process = configured().loadFile(new Uint8Array([3]));
    const report = await process.splitOnly(new Uint8Array([5]));
    const results = await process.extract();
    expect({ read, groups: report.groups, data: results[0]?.data }).toEqual({
      read: [5, 3],
      groups: [{ pages: [1], classification: "invoice" }],
      data: { invoiceNumber: "3" },
    });
  });
});

describe("disposal", () => {
  it("borrows the extractor and releases the splitter and its own loaders", async () => {
    const released: string[] = [];
    const extractor = new Extractor()
      .loadDocumentLoader(fakeLoader({ name: "extractor-loader", onDispose: () => { released.push("extractor-loader"); } }))
      .loadStrategy(fakeStrategy({ onDispose: () => { released.push("strategy"); } }));
    const process = new Process()
      .loadDocumentLoader(fakeLoader({ name: "process-loader", onDispose: () => { released.push("process-loader"); } }))
      .loadSplitter({ ...fakeSplitter(), async dispose() { released.push("splitter"); } })
      .loadExtractor(extractor);

    await process[Symbol.asyncDispose]();
    expect(released.sort()).toEqual(["process-loader", "splitter"]);
  });
});
