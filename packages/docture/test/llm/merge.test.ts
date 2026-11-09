import { expect, it } from "vitest";
import { mergePartials } from "docture/llm/merge";

it.each([
  [[{ total: 0 }, { total: 1234.5 }], { total: 1234.5 }],
  [[{ paid: false }, { paid: true }], { paid: true }],
  [[{ total: 17 }, { total: 0 }], { total: 17 }],
  [[{ total: 0 }, { total: 0 }], { total: 0 }],
  [[{ total: 5 }, { total: 7 }], { total: 5 }],
  [[{ totals: { net: 0 } }, { totals: { net: 10 } }], { totals: { net: 10 } }],
  [[{ paid: true }, { paid: false }], { paid: true }],
  [[{ total: 0 }, { total: "1234.5" }], { total: 0 }],
  [[{ paid: false }, { paid: 1 }], { paid: false }],
  [[{ nested: { total: 0 }, rows: ["same"] }, { nested: { total: 60 }, rows: ["same"] }],
    { nested: { total: 60 }, rows: ["same", "same"] }],
])("replaces same-type zero placeholders without changing other merge rules (%#)", (parts, expected) => {
  expect(mergePartials(parts)).toEqual(expected);
});

it("merges fields named like Object.prototype members as ordinary data", () => {
  const parts: unknown[] = [{ total: 1 }, { constructor: "ACME Corp", toString: "x", total: 2 }];
  expect(mergePartials(parts)).toEqual({ total: 1, constructor: "ACME Corp", toString: "x" });
});

it("keeps a __proto__ field as data without changing the merged object's prototype", () => {
  const merged = mergePartials([{ total: 1 }, JSON.parse('{"__proto__": {"polluted": true}}')]) as Record<string, unknown>;
  expect({
    own: Object.getOwnPropertyDescriptor(merged, "__proto__")?.value,
    prototypeIsObject: Object.getPrototypeOf(merged) === Object.prototype,
  }).toEqual({ own: { polluted: true }, prototypeIsObject: true });
});
