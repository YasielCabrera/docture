import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  contract,
  createExtractor,
  defineClassification,
  Process,
  SplittingStrategy,
  type ValidationRule,
} from "docture";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";

const Totals = z.object({ total: z.number() });
const bytes = new Uint8Array([1]);
const loader = () => inMemoryLoader(loadedDocument(["Invoice total 60.00 with a complete text layer."]));
const sumMismatch: ValidationRule = () => [{ path: "total", message: "Sum mismatch" }];

describe("validation rules", () => {
  it("reports a rule issue with the parsed data in report mode", async () => {
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
    }).extract(bytes, Totals, { rules: [() => [{ path: "total", message: "Sum mismatch" }]] });

    expect(result.data).toEqual({ total: 60 });
    expect(result.method).toBe("primary");
    expect(result.validation).toEqual({ valid: false, issues: [{ path: "total", message: "Sum mismatch" }] });
  });

  it("awaits async rules and keeps their issues in rule order", async () => {
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
    }).extract(bytes, Totals, {
      rules: [
        async (data) => data.total > 50 ? [{ path: "total", message: "Over limit" }] : [],
        () => [{ path: "", message: "Second rule" }],
      ],
    });

    expect(result.validation).toEqual({
      valid: false,
      issues: [{ path: "total", message: "Over limit" }, { path: "", message: "Second rule" }],
    });
  });

  it("fails the attempt with CONTRACT_VIOLATION in fail mode and tries the next strategy", async () => {
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 }), fixedStrategy("fallback", { total: 70 })],
    }).extract(bytes, Totals, {
      onRuleFailure: "fail",
      rules: [(data) => data.total === 60 ? [{ path: "total", message: "Sum mismatch" }] : []],
    });

    expect(result.method).toBe("fallback");
    expect(result.data).toEqual({ total: 70 });
    expect(result.validation).toEqual({ valid: true, issues: [] });
    expect(result.attempts[0]).toMatchObject({
      stage: "extract", strategy: "primary", status: "failed", errorCode: "CONTRACT_VIOLATION",
      issues: [{ path: "total", message: "Sum mismatch" }],
    });
  });

  it("throws CONTRACT_VIOLATION when every strategy fails a rule in fail mode", async () => {
    const run = createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
      onRuleFailure: "fail",
    }).extract(bytes, Totals, { rules: [sumMismatch] });

    await expect(run).rejects.toMatchObject({
      code: "CONTRACT_VIOLATION", issues: [{ path: "total", message: "Sum mismatch" }],
    });
  });

  it("reports a valid empty outcome without rules", async () => {
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
    }).extract(bytes, Totals);

    expect(result.validation).toEqual({ valid: true, issues: [] });
  });

  it("applies extractor rules unless a call replaces or clears them", async () => {
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
      rules: [sumMismatch],
    });

    expect((await extractor.extract(bytes, Totals)).validation.issues).toEqual([
      { path: "total", message: "Sum mismatch" },
    ]);
    expect((await extractor.extract(bytes, Totals, {
      rules: [() => [{ path: "total", message: "Per call" }]],
    })).validation.issues).toEqual([{ path: "total", message: "Per call" }]);
    expect((await extractor.extract(bytes, Totals, { rules: [] })).validation).toEqual({ valid: true, issues: [] });
  });

  it("propagates a thrown rule as an execution error without trying the next strategy", async () => {
    let fallbackRan = false;
    const run = createExtractor({
      loaders: [loader()],
      strategies: [
        fixedStrategy("primary", { total: 60 }),
        { name: "fallback", async extract() { fallbackRan = true; return { data: { total: 1 } }; } },
      ],
    }).extract(bytes, Totals, { rules: [() => { throw new Error("rule bug"); }] });

    await expect(run).rejects.toThrow("rule bug");
    expect(fallbackRan).toBe(false);
  });

  it("forwards rules to every batch item", async () => {
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 })],
    });
    const issues: unknown[] = [];
    const inherited = Object.create({ rules: [sumMismatch], concurrency: 1 }) as { rules: readonly ValidationRule[] };
    for await (const item of extractor.extractBatch([bytes, bytes], Totals, inherited)) {
      if (item.outcome.ok) issues.push(item.outcome.result.validation.issues);
    }
    expect(issues).toEqual([
      [{ path: "total", message: "Sum mismatch" }],
      [{ path: "total", message: "Sum mismatch" }],
    ]);
  });

  it("forwards rules and fail mode through Process to each classified extraction", async () => {
    const invoice = defineClassification({ name: "invoice", description: "an invoice", schema: Totals });
    const extractor = createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60 }), fixedStrategy("fallback", { total: 70 })],
    });
    const [item] = await new Process()
      .loadExtractor(extractor)
      .loadFile(bytes)
      .split([invoice], SplittingStrategy.EAGER)
      .extract({ onRuleFailure: "fail", rules: [(data) => (data as { total: number }).total === 60 ? [{ path: "total", message: "Sum mismatch" }] : []] });

    expect(item?.result.method).toBe("fallback");
    expect(item?.result.attempts.map((attempt) => attempt.errorCode)).toEqual(["CONTRACT_VIOLATION", undefined]);
  });

  it("types per-call rules from the contract", async () => {
    const Invoice = contract({ name: "invoice", schema: z.object({ total: z.number(), lines: z.array(z.number()) }) });
    const result = await createExtractor({
      loaders: [loader()],
      strategies: [fixedStrategy("primary", { total: 60, lines: [10, 20] })],
    }).extract(bytes, Invoice, {
      rules: [(data) => data.lines.reduce((sum, line) => sum + line, 0) === data.total
        ? [] : [{ path: "total", message: `Sum mismatch: lines add to ${data.lines.reduce((a, b) => a + b, 0)}` }]],
    });
    expect(result.validation.issues).toEqual([{ path: "total", message: "Sum mismatch: lines add to 30" }]);
  });
});
