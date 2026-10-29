import { expect, expectTypeOf, it } from "vitest";
import { DoctureError, createExtractor, type ExtractionResult, type Extractor, type InferContract, type ContractLike } from "docture";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { z } from "zod";
import { fromDocture } from "../src/docture/index.js";
import { DatasetError, type EvalExtractor } from "../src/index.js";
const schema = z.object({ total: z.number() });
const input = {
  id: "invoice",
  documents: [
    {
      name: "doc.pdf",
      mimeType: "application/pdf",
      async bytes() {
        return new Uint8Array([37, 80, 68, 70]);
      },
    },
  ],
  expected: { total: 42 },
};
const context = { signal: new AbortController().signal, epoch: 0, experiment: "docture" };
it("adapts real extraction through engine-free testing doubles", async () => {
  const extractor = createExtractor({
    loaders: [inMemoryLoader(loadedDocument(["Invoice total 42 with enough text to extract normally."]))],
    strategies: [fixedStrategy("fixed", { total: 42 })],
  });
  const adapter = fromDocture(extractor, schema, { expectedMethod: "fixed" });
  const output = await adapter.extract(input, context);
  expect(adapter.project?.(output.raw)).toEqual({ total: 42 });
  expect(output).toMatchObject({
    method: "fixed",
    fallback: false,
    usage: { inputTokens: 0, outputTokens: 0, pages: 1 },
    confidence: {},
    evidence: [],
  });
  expect(output.usage && "calls" in output.usage).toBe(false);
  await adapter.dispose?.();
});
it("maps literal tokens, prices, confidence and line evidence", async () => {
  const extractor: Pick<Extractor, "extract" | "dispose"> = {
    async extract<C extends ContractLike>(_source: unknown, contract: C): Promise<ExtractionResult<InferContract<C>>> {
      const real = await createExtractor({
        loaders: [inMemoryLoader(loadedDocument(["Invoice total 42 with enough text to extract normally."]))],
        strategies: [fixedStrategy("fixed", { total: 42 })],
      }).extract(new Uint8Array([37, 80, 68, 70]), contract);
      return {
        ...real,
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, wallMs: 12 },
        attempts: [{ stage: "extract", strategy: "model", status: "failed", ms: 1, usage: { inputTokens: 1000 } }],
        citations: [{ path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.8 }],
        citationSources: [{ id: "p1-line-1", pageNumber: 1, text: "42", box: { x: 1, y: 2, width: 3, height: 4 } }],
      };
    },
    async dispose() {},
  };
  const adapter = fromDocture(extractor, schema, {
    pricing: { model: { inputPerMillion: 2, outputPerMillion: 4 } },
    modelId: "provider/model",
  });
  const output = await adapter.extract(input, context);
  expect(output.usage).toEqual({ inputTokens: 1000, outputTokens: 500, wallMs: 12, pages: 1, costUsd: 0.004 });
  expect(output.confidence).toEqual({ total: 0.8 });
  expect(output.evidence).toEqual([
    { path: "total", status: "verified", confidence: 0.8, pageNumber: 1, box: { x: 1, y: 2, width: 3, height: 4 } },
  ]);
  expect(output.fallback).toBe(true);
});
it("converts dotted array paths and excludes unlocated native evidence", async () => {
  const schema = z.object({ "a.b": z.array(z.object({ amount: z.number() })) });
  const data = { "a.b": [{ amount: 42 }] };
  const extractor: Pick<Extractor, "extract" | "dispose"> = {
    async extract(source, contract, options) {
      const real = await createExtractor({
        loaders: [inMemoryLoader(loadedDocument(["Amount 42 in a long enough document for normal extraction."]))],
        strategies: [fixedStrategy("fixed", data)],
      }).extract(source, contract, options);
      return {
        ...real,
        citations: [
          {
            path: "`a.b`.0.amount",
            status: "verified",
            ids: ["p1-element-aaaaaaaaaaaa", "p2-element-bbbbbbbbbbbb", "p3-element-cccccccccccc"],
            minOcrConfidence: 0.75,
          },
        ],
        evidenceSources: [
          {
            id: "p1-element-aaaaaaaaaaaa",
            granularity: "element",
            elementId: "a",
            pageNumber: 1,
            text: "42",
            order: 0,
            location: { kind: "physical", pageNumber: 1, box: { x: 10, y: 20, width: 30, height: 40 }, sourceDigest: "hash" },
          },
          {
            id: "p2-element-bbbbbbbbbbbb",
            granularity: "element",
            elementId: "b",
            pageNumber: 2,
            text: "42",
            order: 1,
            location: { kind: "logical", pageNumber: 2 },
          },
          {
            id: "p3-element-cccccccccccc",
            granularity: "element",
            elementId: "c",
            pageNumber: 3,
            text: "42",
            order: 2,
            location: { kind: "unlocated", pageNumbers: [3] },
          },
        ],
      };
    },
    async dispose() {},
  };
  const output = await fromDocture(extractor, schema).extract(input, context);
  expect(output.confidence).toEqual({ "`a.b`[0].amount": 0.75 });
  expect(output.evidence).toEqual([
    { path: "`a.b`[0].amount", status: "verified", confidence: 0.75, pageNumber: 1, box: { x: 10, y: 20, width: 30, height: 40 } },
    { path: "`a.b`[0].amount", status: "verified", confidence: 0.75, pageNumber: 2 },
  ]);
});
it("leaves docture's source errors as extraction failures", async () => {
  class ForeignUnsupported extends DoctureError {
    protected static override readonly doctureErrorIdentity = "UnsupportedSourceError";
    readonly code = "UNSUPPORTED_SOURCE";
  }
  const failure = new ForeignUnsupported("unsupported");
  const unsupported = fromDocture(
    {
      async extract() {
        throw failure;
      },
      async dispose() {},
    },
    schema,
  );
  await expect(unsupported.extract(input, context)).rejects.toBe(failure);
});

it("rejects an empty document as a dataset error without calling docture", async () => {
  let calls = 0;
  const adapter = fromDocture(
    {
      async extract() {
        calls++;
        throw new Error("unreachable");
      },
      async dispose() {},
    },
    schema,
  );
  const empty = {
    ...input,
    documents: [
      {
        name: "doc.pdf",
        mimeType: "application/pdf",
        async bytes() {
          return new Uint8Array();
        },
      },
    ],
  };
  const error = await adapter.extract(empty, context).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DatasetError);
  expect(error).toMatchObject({ caseId: "invoice" });
  expect(calls).toBe(0);
});

const cited = (
  citations: ExtractionResult<{ total: number }>["citations"],
  citationSources: ExtractionResult<{ total: number }>["citationSources"],
): Pick<Extractor, "extract" | "dispose"> => ({
  async extract(source, contract, options) {
    const real = await createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["Invoice total 42 with enough text to extract normally."]))],
      strategies: [fixedStrategy("fixed", { total: 42 })],
    }).extract(source, contract, options);
    return { ...real, ...(citations ? { citations } : {}), ...(citationSources ? { citationSources } : {}) };
  },
  async dispose() {},
});

it("drops confidence and evidence under a custom projection because their paths name the contract", async () => {
  const extractor = cited(
    [{ path: "total", status: "verified", ids: ["p1-line-1"], minOcrConfidence: 0.8 }],
    [{ id: "p1-line-1", pageNumber: 1, text: "42", box: { x: 1, y: 2, width: 3, height: 4 } }],
  );
  const adapter = fromDocture(extractor, schema, { project: (result) => ({ amount: result.data.total }) });
  const output = await adapter.extract(input, context);
  expect(adapter.project?.(output.raw)).toEqual({ amount: 42 });
  expect(output.confidence).toBeUndefined();
  expect(output.evidence).toBeUndefined();
});

it("cites a line without spans by page only", async () => {
  const extractor = cited(
    [{ path: "total", status: "verified", ids: ["p1-line-1"] }],
    [{ id: "p1-line-1", pageNumber: 1, text: "42", box: { x: 0, y: 5, width: 0, height: 10 } }],
  );
  const output = await fromDocture(extractor, schema).extract(input, context);
  expect(output.evidence).toEqual([{ path: "total", status: "verified", pageNumber: 1 }]);
});

it("types the comparable view as the contract unless a projection says otherwise", () => {
  const extractor = cited(undefined, undefined);
  const contractView: EvalExtractor<unknown, { total: number }> = fromDocture(extractor, schema);
  const projected: EvalExtractor<unknown, { amount: number }> = fromDocture(extractor, schema, {
    project: (result) => ({ amount: result.data.total }),
  });
  expectTypeOf(fromDocture(extractor, schema)).toExtend<EvalExtractor<unknown, { total: number }>>();
  expectTypeOf(fromDocture(extractor, schema)).not.toExtend<EvalExtractor<unknown, { amount: number }>>();
  expectTypeOf(projected).toExtend<EvalExtractor<unknown, { amount: number }>>();
  expect([contractView.id, projected.id]).toEqual(["docture", "docture"]);
});
it("prices the usage of a failed extraction and keeps docture's error for the errored row", async () => {
  const { runEval } = await import("../src/runner/index.js");
  const { inMemoryDataset, looseEval } = await import("../src/index.js");
  class ExtractionFailed extends DoctureError {
    readonly code = "EXTRACTION_FAILED";
    usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly wallMs: number;
      readonly costUsd?: number;
    } = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, wallMs: 12 };
  }
  const failure = new ExtractionFailed("Every extraction strategy failed: model (bad JSON).");
  Object.freeze(failure.usage);
  Object.freeze(failure);
  const extractor: Pick<Extractor, "extract" | "dispose"> = {
    async extract() {
      throw failure;
    },
    async dispose() {},
  };
  const adapter = fromDocture(extractor, schema, {
    pricing: { model: { inputPerMillion: 2, outputPerMillion: 4 } },
    modelId: "provider/model",
  });
  const thrown = await adapter.extract(input, context).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ cause: failure, name: failure.name, code: failure.code, usage: { ...failure.usage, costUsd: 0.004 } });
  expect(failure.usage).toEqual({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500, wallMs: 12 });
  const result = await runEval({ dataset: inMemoryDataset("x", [input]), spec: looseEval(), experiments: adapter });
  expect(result.cases[0]).toMatchObject({
    outcome: "errored",
    error: { name: failure.name, code: "EXTRACTION_FAILED" },
    usage: { inputTokens: 1000, outputTokens: 500, wallMs: 12, costUsd: 0.004 },
  });
  expect(result.summary.docture?.overall["costUsd"]).toBe(0.004);
});
