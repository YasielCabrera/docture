import { describe, expect, it } from "vitest";
import { defineModel } from "../src/index.js";
import { fakerFor } from "../src/faker/index.js";
import { Invoice, invoiceFields, withTotals } from "./fixtures.js";

describe("fakerFor", () => {
  it("gives the same German names for the same seed and different ones for another seed", async () => {
    const f = await fakerFor("de");
    const model = defineModel(Invoice, {
      fields: { ...invoiceFields, "seller.name": f((faker) => faker.company.name()), "buyer.name": f((faker) => faker.person.fullName()) },
      derive: withTotals,
    });
    const first = await model.sample({ seed: 3 });
    const again = await model.sample({ seed: 3 });
    const other = await model.sample({ seed: 4 });
    expect([first.value.seller.name, first.value.buyer.name]).toEqual(["Panzig-Richter", "Viktoria Lichtl"]);
    expect([again.value.seller.name, again.value.buyer.name]).toEqual(["Panzig-Richter", "Viktoria Lichtl"]);
    expect([other.value.seller.name, other.value.buyer.name]).toEqual(["Schönfeld OHG", "Michelle Herold"]);
  });

  it("draws each position from its own stream, so adding a faker field leaves the others unchanged", async () => {
    const f = await fakerFor("de-AT");
    const description = f((faker) => faker.commerce.productName());
    const lines = { ...invoiceFields, "lineItems[].description": description };
    const base = await defineModel(Invoice, { fields: lines, derive: withTotals }).sample({ seed: 9 });
    const more = await defineModel(Invoice, { fields: { ...lines, "buyer.contact": f((faker) => faker.person.lastName()) }, derive: withTotals }).sample({ seed: 9 });
    const descriptions = base.value.lineItems.map((item) => item.description);
    expect(descriptions).toEqual(["Electronic Steel Bacon", "Fresh Bamboo Chicken", "Ergonomic Plastic Cheese", "Sleek Bamboo Keyboard", "Intelligent Metal Computer", "Fresh Granite Computer"]);
    expect(more.value.lineItems.map((item) => item.description)).toEqual(descriptions);
    expect(more.value.buyer.contact).toBe("Bayer");
  });

  it("rejects an unknown locale and names some known ones", async () => {
    await expect(fakerFor("xx")).rejects.toThrow(new RangeError('Unknown faker locale "xx". Known locales include de, en_US, es, fr, ja, pt_BR and 70 more'));
  });
});
