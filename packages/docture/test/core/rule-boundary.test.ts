import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExtractor,
  defineClassification,
  Process,
  SplittingStrategy,
  type ExtractionStrategy,
  type ValidationRule,
} from "docture";
import { fixedStrategy, inMemoryLoader, loadedDocument } from "docture/testing/doubles";

const Totals = z.object({ total: z.number() });
const bytes = new Uint8Array([1]);
const loader = () => inMemoryLoader(loadedDocument(["Invoice total 60.00 with a complete text layer."]));
const MODE_MESSAGE = 'onRuleFailure must be "report" or "fail"; received "typo"';

function countingStrategy(): ExtractionStrategy & { readonly runs: number } {
  let runs = 0;
  return {
    name: "counting",
    get runs() { return runs; },
    async extract() {
      runs += 1;
      return { data: { total: 60 } };
    },
  };
}

const extractWith = (rules: readonly unknown[], strategies: ExtractionStrategy[] = [fixedStrategy("primary", { total: 60 })]) =>
  createExtractor({ loaders: [loader()], strategies })
    .extract(bytes, Totals, { rules: rules as readonly ValidationRule<{ total: number }>[] });

describe("rule settings at the public boundary", () => {
  it("rejects an unknown extractor rule mode when the extractor is created", () => {
    expect(() => createExtractor({ loaders: [loader()], onRuleFailure: "typo" as never })).toThrow(new RangeError(MODE_MESSAGE));
  });

  it("rejects an unknown per-call rule mode before any strategy runs", async () => {
    const strategy = countingStrategy();
    const run = createExtractor({ loaders: [loader()], strategies: [strategy] })
      .extract(bytes, Totals, { onRuleFailure: "typo" as never });
    await expect(run).rejects.toThrow(new RangeError(MODE_MESSAGE));
    expect(strategy.runs).toBe(0);
  });

  it("rejects a null per-call rule mode instead of using the extractor's mode", async () => {
    const strategy = countingStrategy();
    const run = createExtractor({ loaders: [loader()], strategies: [strategy] })
      .extract(bytes, Totals, { onRuleFailure: null as never });
    await expect(run).rejects.toThrow(new RangeError('onRuleFailure must be "report" or "fail"; received null'));
    expect(strategy.runs).toBe(0);
  });

  it("rejects an unknown rule mode passed to Process before any strategy runs", async () => {
    const strategy = countingStrategy();
    const invoice = defineClassification({ name: "invoice", description: "an invoice", schema: Totals });
    const run = new Process()
      .loadExtractor(createExtractor({ loaders: [loader()], strategies: [strategy] }))
      .loadFile(bytes)
      .split([invoice], SplittingStrategy.EAGER)
      .extract({ onRuleFailure: "typo" as never });
    await expect(run).rejects.toThrow(new RangeError(MODE_MESSAGE));
    expect(strategy.runs).toBe(0);
  });

  it("rejects a rule that returns undefined instead of reporting no issues", async () => {
    await expect(extractWith([() => []], [fixedStrategy("primary", { total: 60 })]).then((result) => result.validation))
      .resolves.toEqual({ valid: true, issues: [] });
    await expect(extractWith([() => [], function totalsMatch() { return undefined; }])).rejects.toThrow(new TypeError(
      "Validation rule 1 (totalsMatch) returned undefined. Return an array of { path: string, message: string } issues, or [] when the data passes.",
    ));
  });

  it("rejects an async rule that resolves to a single issue rather than an array", async () => {
    await expect(extractWith([async () => ({ path: "total", message: "Over limit" })])).rejects.toThrow(new TypeError(
      'Validation rule 0 returned {"path":"total","message":"Over limit"}. Return an array of { path: string, message: string } issues, or [] when the data passes.',
    ));
  });

  it("rejects a rule issue without a string path and message", async () => {
    await expect(extractWith([() => [{ path: "total", message: "Over limit" }, { field: "total" }]])).rejects.toThrow(new TypeError(
      'Validation rule 0 returned an invalid issue at index 1: {"field":"total"}. Return an array of { path: string, message: string } issues, or [] when the data passes.',
    ));
  });

  it("rejects a malformed rule result without trying the next strategy", async () => {
    const fallback = countingStrategy();
    await expect(extractWith([() => [null]], [fixedStrategy("primary", { total: 60 }), fallback])).rejects.toThrow(TypeError);
    expect(fallback.runs).toBe(0);
  });

  it("keeps valid async issues in report mode", async () => {
    const result = await createExtractor({ loaders: [loader()], strategies: [fixedStrategy("primary", { total: 60 })], onRuleFailure: "report" })
      .extract(bytes, Totals, { rules: [async () => [{ path: "total", message: "Over limit" }]] });
    expect(result.validation).toEqual({ valid: false, issues: [{ path: "total", message: "Over limit" }] });
  });
});
