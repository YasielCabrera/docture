import { describe, expect, it } from "vitest";
import { DocumentConverter, type LoadedDocument } from "../../src/core/index.js";
import { textLayerDocument } from "./conversion-fixtures.js";

async function markdown(loaded: LoadedDocument): Promise<string> {
  return (await new DocumentConverter().convert({ loaded })).content;
}

describe("two-column reading order", () => {
  it("keeps an indented first line ahead of the rest of its column", async () => {
    const loaded = textLayerDocument([
      [100, ["As many as 400 wells have been", 56, 190], ["Right column opens here and", 315, 240]],
      [111.5, ["drilled in the Norphlet to date, resulting", 36, 215], ["continues with a second line of", 315, 240]],
      [123, ["in cumulative production of oil.", 36, 200], ["text that ends the right column.", 315, 240]],
    ]);
    expect(await markdown(loaded)).toBe([
      "<!-- page: 1 -->",
      "As many as 400 wells have been\ndrilled in the Norphlet to date, resulting\nin cumulative production of oil.",
      "Right column opens here and\ncontinues with a second line of\ntext that ends the right column.",
    ].join("\n\n"));
  });

  it("splits text-layer lines that cross a narrow but clear column gutter", async () => {
    const loaded = textLayerDocument([
      [33, ["in the development of a large eolian sand", 36, 243], ["clear gradient in thermal maturity rising", 315, 252]],
      [44.5, ["the mountain chain, comparable to ergs in", 36, 252], ["a related change in petroleum type from", 315, 246]],
      [56, ["modern desert environments. Within the erg,", 36, 261], ["the formation becomes deeper and hotter.", 315, 248]],
      [67.5, ["sand dunes formed the reservoirs.", 36, 200]],
    ]);
    expect(await markdown(loaded)).toBe([
      "<!-- page: 1 -->",
      "in the development of a large eolian sand\nthe mountain chain, comparable to ergs in\nmodern desert environments. Within the erg,\nsand dunes formed the reservoirs.",
      "clear gradient in thermal maturity rising\na related change in petroleum type from\nthe formation becomes deeper and hotter.",
    ].join("\n\n"));
  });

  it("keeps a tagged heading role on the heading half of a line split at the gutter", async () => {
    const loaded = textLayerDocument([
      [73.7, ["Requester of Form W-9 for more information. See", 36, 232, 8], ["owner's name is required to be provided on line 1.", 316.8, 240, 8]],
      [82.7, ["also Establishing U.S. status for purposes of the", 36, 233, 8], ["the entity is also a disregarded entity, enter the", 316.8, 245, 8]],
      [91.7, ["chapter 4 withholding rules, as described earlier.", 36, 230, 8], ["disregarded for federal tax purposes. Enter the", 316.8, 240, 8]],
      [100.7, ["name on line 2. If the owner is a foreign person,", 316.8, 259, 8]],
      [109.7, ["What Is FATCA Reporting?", 36, 152.7, 12], ["the owner must complete an appropriate Form W-8", 316.8, 248.7, 8]],
      [127.7, ["The Foreign Account Tax Compliance Act requires a", 36, 218.4, 8]],
    ]);
    const page = loaded.pages[0];
    const blocks = page?.blocks?.map((block, index) => (index === 4 ? { ...block, role: "heading" as const, level: 3 } : block));
    const tagged = { ...loaded, pages: [{ ...page!, ...(blocks === undefined ? {} : { blocks }) }] };
    expect(await markdown(tagged)).toBe([
      "<!-- page: 1 -->",
      "Requester of Form W-9 for more information. See\nalso Establishing U.S. status for purposes of the\nchapter 4 withholding rules, as described earlier.",
      "### What Is FATCA Reporting?",
      "The Foreign Account Tax Compliance Act requires a",
      "owner's name is required to be provided on line 1.\nthe entity is also a disregarded entity, enter the\ndisregarded for federal tax purposes. Enter the\nname on line 2. If the owner is a foreign person,\nthe owner must complete an appropriate Form W-8",
    ].join("\n\n"));
  });
});
