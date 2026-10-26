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
