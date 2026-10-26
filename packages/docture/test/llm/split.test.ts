/**
 * `TextSplitter` and `ImageSplitter`, through the real `generateObject` path.
 *
 * The interesting behaviour is not "does it call the model" — it is what happens
 * when the model answers badly, which for a splitter means a page silently
 * disappearing from the batch.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Extractor,
  Process,
  SplittingStrategy,
  UNCLASSIFIED,
  defineClassification,
  runSplitter,
  silentLogger,
  type LoadedPage,
  type SplitContext,
} from "docture";
import { ImageSplitter, TextSplitter, imageSplitter, textSplitter } from "../../src/llm/index.js";
import { memoryCache } from "../../src/llm/cache.js";
import { mockModel } from "./mock-model.js";

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

function pages(texts: readonly string[], renderable = false): LoadedPage[] {
  return texts.map((text, i) => ({
    pageNumber: i + 1,
    width: 595,
    height: 842,
    text,
    ...(renderable
      ? { image: async (): Promise<Uint8Array> => new Uint8Array([0x89, 0x50, i + 1]) }
      : {}),
  }));
}

const ctx = (recordUsage?: SplitContext["recordUsage"]): SplitContext => ({
  classifications: [invoice, licence],
  signal: new AbortController().signal,
  logger: silentLogger,
  ...(recordUsage === undefined ? {} : { recordUsage }),
});

describe("TextSplitter", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects invalid eager window sizes (%s)", async (maxEagerPages) => {
    const { model } = mockModel([{}]);
    await expect(new TextSplitter({ model, maxEagerPages }).splitEager(pages(["a"]), ctx()))
      .rejects.toThrow("maxEagerPages must be a positive integer");
  });

  it("returns no groups without model requests for an empty eager bundle", async () => {
    const { model, calls } = mockModel([{}]);
    const groups = await new TextSplitter({ model }).splitEager([], ctx());
    expect({ groups, calls: calls.length }).toEqual({ groups: [], calls: 0 });
  });

  it("declares that it needs a text layer", () => {
    const { model } = mockModel([{}]);
    expect(new TextSplitter({ model }).requires).toEqual(["TEXT_LAYER"]);
    expect(textSplitter({ model }).name).toBe("TextSplitter");
  });

  it("judges a seam and reports both page kinds", async () => {
    const { model } = mockModel([
      {
        belongsToSameDocument: false,
        classificationPage1: "invoice",
        classificationPage2: "licence",
        confidence: 0.9,
      },
    ]);

    const [first, second] = pages(["INVOICE", "LICENCE"]);
    const verdict = await new TextSplitter({ model }).belongsToSameDocument(
      first!,
      second!,
      ctx(),
    );

    expect(verdict).toMatchObject({
      belongsToSameDocument: false,
      classificationPage1: "invoice",
      classificationPage2: "licence",
    });
  });

  /** A model will answer "Invoice" for a candidate named "invoice". */
  it("matches a candidate case-insensitively, keeping the candidate's spelling", async () => {
    const { model } = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "Invoice",
        classificationPage2: "INVOICE",
        confidence: 1,
      },
    ]);
    const [first, second] = pages(["a", "b"]);
    const verdict = await new TextSplitter({ model }).belongsToSameDocument(first!, second!, ctx());
    expect(verdict.classificationPage1).toBe("invoice");
    expect(verdict.classificationPage2).toBe("invoice");
  });

  it("turns an invented kind into UNKNOWN rather than passing it on", async () => {
    const { model } = mockModel([
      {
        belongsToSameDocument: false,
        classificationPage1: "bill-of-lading",
        classificationPage2: "invoice",
        confidence: 1,
      },
    ]);
    const [first, second] = pages(["a", "b"]);
    const verdict = await new TextSplitter({ model }).belongsToSameDocument(first!, second!, ctx());
    expect(verdict.classificationPage1).toBe(UNCLASSIFIED);
    expect(verdict.classificationPage2).toBe("invoice");
  });

  it("sends only an excerpt of each page", async () => {
    const { model, calls } = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "invoice",
        classificationPage2: "invoice",
        confidence: 1,
      },
    ]);
    const [first, second] = pages(["A".repeat(5000), "B".repeat(5000)]);
    await new TextSplitter({ model, excerptChars: 100 }).belongsToSameDocument(
      first!,
      second!,
      ctx(),
    );

    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("A".repeat(100));
    expect(sent).not.toContain("A".repeat(101));
  });

  it("reports what the request cost", async () => {
    const { model } = mockModel(
      [
        {
          belongsToSameDocument: true,
          classificationPage1: "invoice",
          classificationPage2: "invoice",
          confidence: 1,
        },
      ],
      { inputTokens: 500, outputTokens: 20 },
    );

    let total = 0;
    const [first, second] = pages(["a", "b"]);
    await new TextSplitter({ model }).belongsToSameDocument(
      first!,
      second!,
      ctx((usage) => {
        total += usage.totalTokens ?? 0;
      }),
    );
    expect(total).toBe(520);
  });

  it("caches a seam, so a re-run over the same bundle costs nothing", async () => {
    const { model, calls } = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "invoice",
        classificationPage2: "invoice",
        confidence: 1,
      },
    ]);
    const splitter = new TextSplitter({ model, cache: memoryCache() });
    const [first, second] = pages(["a", "b"]);

    await splitter.belongsToSameDocument(first!, second!, ctx());
    await splitter.belongsToSameDocument(first!, second!, ctx());
    expect(calls).toHaveLength(1);
  });

  it("does not confuse two different seams in the cache", async () => {
    const { model, calls } = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "invoice",
        classificationPage2: "invoice",
        confidence: 1,
      },
    ]);
    const splitter = new TextSplitter({ model, cache: memoryCache() });
    const [a, b, c] = pages(["alpha", "beta", "gamma"]);

    await splitter.belongsToSameDocument(a!, b!, ctx());
    await splitter.belongsToSameDocument(b!, c!, ctx());
    expect(calls).toHaveLength(2);
  });
});

describe("TextSplitter under EAGER", () => {
  it("returns the groups the model reported", async () => {
    const { model } = mockModel([
      {
        documents: [
          { pages: [1, 2], classification: "invoice", confidence: 0.9 },
          { pages: [3], classification: "licence", confidence: 0.9 },
        ],
      },
    ]);

    const groups = await new TextSplitter({ model }).splitEager(
      pages(["a", "b", "c"]),
      ctx(),
    );
    expect(groups).toEqual([
      { pages: [1, 2], classification: "invoice", confidence: 0.9 },
      { pages: [3], classification: "licence", confidence: 0.9 },
    ]);
  });

  /**
   * The failure that matters. A page the model forgot vanishes from the extraction
   * with nothing in the output to say it existed.
   */
  it("adopts a page the model forgot into the document before it", async () => {
    const { model } = mockModel([
      { documents: [{ pages: [1, 2], classification: "invoice", confidence: 0.9 }] },
    ]);

    const groups = await new TextSplitter({ model }).splitEager(pages(["a", "b", "c"]), ctx());
    expect(groups.flatMap((g) => g.pages)).toEqual([1, 2, 3]);
  });

  it("puts a forgotten FIRST page in a group of its own", async () => {
    const { model } = mockModel([
      { documents: [{ pages: [2, 3], classification: "invoice", confidence: 0.9 }] },
    ]);

    const groups = await new TextSplitter({ model }).splitEager(pages(["a", "b", "c"]), ctx());
    expect(groups.map((g) => [g.classification, g.pages])).toEqual([
      [UNCLASSIFIED, [1]],
      ["invoice", [2, 3]],
    ]);
  });

  it("discards a page number the document does not have", async () => {
    const { model } = mockModel([
      { documents: [{ pages: [1, 2, 99], classification: "invoice", confidence: 0.9 }] },
    ]);

    const groups = await new TextSplitter({ model }).splitEager(pages(["a", "b"]), ctx());
    expect(groups).toEqual([{ pages: [1, 2], classification: "invoice", confidence: 0.9 }]);
  });

  it("deduplicates and sorts the pages of a group", async () => {
    const { model } = mockModel([
      { documents: [{ pages: [3, 1, 1, 2], classification: "invoice", confidence: 0.9 }] },
    ]);
    const groups = await new TextSplitter({ model }).splitEager(pages(["a", "b", "c"]), ctx());
    expect(groups[0]?.pages).toEqual([1, 2, 3]);
  });

  it("sends every eager window and keeps groups separate when the seam rejects a merge", async () => {
    const { model, calls } = mockModel([
      { documents: [{ pages: [1, 2, 3], classification: "invoice", confidence: 0.9 }] },
      { documents: [{ pages: [2, 3, 4], classification: "licence", confidence: 0.8 }] },
      { belongsToSameDocument: false, classificationPage1: "invoice", classificationPage2: "licence", confidence: 1 },
    ]);
    const groups = await new TextSplitter({ model, maxEagerPages: 2 }).splitEager(
      pages(["alpha", "bravo", "charlie", "delta"]), ctx(),
    );

    expect(groups).toEqual([
      { pages: [1, 2], classification: "invoice", confidence: 0.9 },
      { pages: [3, 4], classification: "licence", confidence: 0.8 },
    ]);
    expect(calls).toHaveLength(3);
    const sent = JSON.stringify(calls);
    for (const text of ["alpha", "bravo", "charlie", "delta"]) expect(sent).toContain(text);
  });

  it("joins eager windows only after seam approval and keeps the earlier classification and lower confidence", async () => {
    const { model, calls } = mockModel([
      { documents: [{ pages: [1, 2], classification: "invoice", confidence: 0.9 }] },
      { documents: [{ pages: [3, 4], classification: "licence", confidence: 0.7 }] },
      { belongsToSameDocument: true, classificationPage1: "licence", classificationPage2: "licence", confidence: 1 },
    ]);
    const groups = await new TextSplitter({ model, maxEagerPages: 2 }).splitEager(pages(["a", "b", "c", "d"]), ctx());
    expect(groups).toEqual([{ pages: [1, 2, 3, 4], classification: "invoice", confidence: 0.7 }]);
    expect(calls).toHaveLength(3);
  });

  it("joins an eager seam to the group that owns the actual boundary page", async () => {
    const { model, calls } = mockModel([
      { documents: [
        { pages: [1, 4], classification: "invoice", confidence: 0.9 },
        { pages: [2, 3], classification: "licence", confidence: 0.8 },
      ] },
      { documents: [{ pages: [5, 6], classification: "invoice", confidence: 0.7 }] },
      { belongsToSameDocument: true, classificationPage1: "invoice", classificationPage2: "invoice", confidence: 1 },
    ]);
    const groups = await new TextSplitter({ model, maxEagerPages: 4 }).splitEager(pages(["a", "b", "c", "d", "e", "f"]), ctx());
    expect(groups).toEqual([
      { pages: [1, 4, 5, 6], classification: "invoice", confidence: 0.7 },
      { pages: [2, 3], classification: "licence", confidence: 0.8 },
    ]);
    expect(calls).toHaveLength(3);
  });
});

describe("ImageSplitter", () => {
  it("declares that it needs renderable pages", () => {
    const { model } = mockModel([{}]);
    expect(new ImageSplitter({ model }).requires).toEqual(["RENDERABLE_PAGES"]);
    expect(imageSplitter({ model }).name).toBe("ImageSplitter");
  });

  it("sends the page images, not the text", async () => {
    const { model, calls } = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "invoice",
        classificationPage2: "invoice",
        confidence: 1,
      },
    ]);
    const [first, second] = pages(["SECRET TEXT", "ALSO SECRET"], true);
    await new ImageSplitter({ model }).belongsToSameDocument(first!, second!, ctx());

    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).not.toContain("SECRET TEXT");
    expect(sent).toContain("file");
  });

  /** A page that cannot render is a wiring mistake, and should say which one. */
  it("names the fix when the loader cannot render", async () => {
    const { model } = mockModel([{}]);
    const [first, second] = pages(["a", "b"]);
    await expect(
      new ImageSplitter({ model }).belongsToSameDocument(first!, second!, ctx()),
    ).rejects.toThrowError(/withRasterizer/);
  });
});

describe("through runSplitter and Process", () => {
  it("cuts a real bundle end to end", async () => {
    // Two seam answers, then the extractions.
    const splitModel = mockModel([
      {
        belongsToSameDocument: true,
        classificationPage1: "invoice",
        classificationPage2: "invoice",
        confidence: 1,
      },
      {
        belongsToSameDocument: false,
        classificationPage1: "invoice",
        classificationPage2: "licence",
        confidence: 1,
      },
    ]);

    const groups = await runSplitter(
      new TextSplitter({ model: splitModel.model }),
      pages(["INVOICE page 1", "invoice page 2", "LICENCE"]),
      SplittingStrategy.LAZY,
      ctx(),
      { concurrency: 1 },
    );

    expect(groups.map((g) => [g.classification, g.pages])).toEqual([
      ["invoice", [1, 2]],
      ["licence", [3]],
    ]);
  });

  it("drives a Process from file to typed documents", async () => {
    const bundleText = [
      "INVOICE INV-42 for services rendered, with plenty of text on this page",
      "LICENCE DL-9 belonging to someone, also with plenty of text on this page",
    ].join("\f");

    const splitModel = mockModel([
      {
        documents: [
          { pages: [1], classification: "invoice", confidence: 1 },
          { pages: [2], classification: "licence", confidence: 1 },
        ],
      },
    ]);
    const extractModel = mockModel([{ invoiceNumber: "INV-42" }, { licenceNumber: "DL-9" }]);

    const { DocumentLoaderData, LLM } = await import("./harness.js");

    const extractor = new Extractor()
      .loadDocumentLoader(new DocumentLoaderData())
      .loadLlm(new LLM(extractModel.model));

    const documents = await new Process()
      .loadExtractor(extractor)
      .loadSplitter(new TextSplitter({ model: splitModel.model }))
      .loadFile({
        bytes: new TextEncoder().encode(bundleText),
        mimeType: "text/plain",
      })
      .split([invoice, licence], SplittingStrategy.EAGER)
      .extract({ concurrency: 1 });

    expect(documents.map((d) => d.name)).toEqual(["invoice", "licence"]);
    for (const document of documents) {
      if (document.name === "invoice") expect(document.data.invoiceNumber).toBe("INV-42");
      else expect(document.data.licenceNumber).toBe("DL-9");
    }
  });
});
