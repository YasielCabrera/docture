/**
 * The closed vocabularies.
 *
 * Each must work BOTH ways: `CompletionStrategy.PAGINATE` for discoverability, and
 * the bare string `"paginate"` for a config file that never imported anything. A
 * TypeScript `enum` would have given the first and taken the second.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ClassificationStrategy,
  CompletionStrategy,
  SplittingStrategy,
  type ConsensusStrategy,
} from "../src/index.js";

describe("the enum objects", () => {
  it("carry the literal strings", () => {
    expect(CompletionStrategy.FORBIDDEN).toBe("forbidden");
    expect(CompletionStrategy.PAGINATE).toBe("paginate");
    expect(CompletionStrategy.CONCATENATE).toBe("concatenate");
    expect(SplittingStrategy.EAGER).toBe("eager");
    expect(SplittingStrategy.LAZY).toBe("lazy");
    expect(ClassificationStrategy.CONSENSUS).toBe("consensus");
    expect(ClassificationStrategy.HIGHER_ORDER).toBe("higherOrder");
    expect(ClassificationStrategy.CONSENSUS_WITH_THRESHOLD).toBe("consensusWithThreshold");
  });

  it("are types as well as values", () => {
    expectTypeOf<CompletionStrategy>().toEqualTypeOf<"forbidden" | "paginate" | "concatenate">();
    expectTypeOf<SplittingStrategy>().toEqualTypeOf<"eager" | "lazy">();
  });

  it("accept the bare string, so a config file needs no import", () => {
    const fromConfig: CompletionStrategy = "paginate";
    const strategy: SplittingStrategy = "lazy";
    expect([fromConfig, strategy]).toEqual(["paginate", "lazy"]);
  });

  /** The reconciliation names must stay in step, or `classify` takes two vocabularies. */
  it("ClassificationStrategy IS the classifier consensus vocabulary", () => {
    expectTypeOf<ClassificationStrategy>().toEqualTypeOf<ConsensusStrategy>();
  });

  it("rejects a value that is not in the vocabulary", () => {
    // @ts-expect-error — "sometimes" is not a completion strategy
    const wrong: CompletionStrategy = "sometimes";
    expect(wrong).toBeDefined();
  });
});
