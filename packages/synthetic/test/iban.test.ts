import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineModel } from "../src/model.js";
import { gen, type Generator, type IbanOptions } from "../src/generators.js";

const sample = async (identifier: Generator<string>, seed: number | string = 7): Promise<string> =>
  (await defineModel(z.object({ identifier: z.string() }), { fields: { identifier } }).sample({ seed })).value.identifier;

const remainder = (iban: string): bigint => {
  const rearranged = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/gu, (letter) => String(letter.charCodeAt(0) - 55));
  return BigInt(rearranged) % 97n;
};

describe("gen.iban", () => {
  it.each([
    { country: "DE", bban: "370400440532013000", expected: "DE89370400440532013000" },
    { country: "GB", bban: "WEST12345698765432", expected: "GB82WEST12345698765432" },
    { country: "NO", bban: "86011117947", expected: "NO9386011117947" },
  ])("composes one checksum-valid field for $country from supplied parts", async ({ country, bban, expected }) => {
    const identifier = gen.iban({ country, bban: gen.value(bban) });
    expectTypeOf(identifier).toEqualTypeOf<Generator<string>>();
    const value = await sample(identifier);
    expect(value).toBe(expected);
    expect(remainder(value)).toBe(1n);
  });

  it("uses the caller's schema and related field paths without imposing an account object", async () => {
    const Record = z.object({ region: z.enum(["DE", "GB"]), institution: z.string(), ledger: z.string(), reference: z.string() });
    const model = defineModel(Record, {
      fields: {
        region: gen.pick(["DE", "GB"]),
        institution: gen.from((context) => context.sibling<string>("region") === "DE" ? "37040044" : "WEST123456"),
        ledger: gen.from((context) => gen.pattern(context.get<string>("region") === "DE" ? "##########" : "########").generate(context)),
        reference: gen.iban({
          country: gen.from((context) => context.sibling<string>("region")),
          bban: gen.from((context) => context.get<string>("institution") + context.sibling<string>("ledger")),
        }),
      },
    });
    const values = await Promise.all(Array.from({ length: 20 }, async (_, seed) => (await model.sample({ seed })).value));
    expect(new Set(values.map((value) => value.region))).toEqual(new Set(["DE", "GB"]));
    for (const value of values) {
      expect(value.reference.slice(0, 2)).toBe(value.region);
      expect(value.reference.slice(4)).toBe(value.institution + value.ledger);
      expect(remainder(value.reference)).toBe(1n);
    }
  });

  it("repeats seeded fields and isolates country draws from BBAN draws", async () => {
    const body = gen.pattern("##################");
    const fixed = gen.iban({ country: "DE", bban: body });
    const generated = gen.iban({ country: gen.from(({ stream }) => { stream.next(); stream.next(); return "DE"; }), bban: body });
    expect(await sample(fixed)).toBe(await sample(fixed));
    expect(await sample(fixed, 8)).not.toBe(await sample(fixed, 7));
    expect(await sample(generated, 7)).toBe(await sample(fixed, 7));
  });

  it("snapshots the option references and includes both generators in source identity", async () => {
    const country = gen.value("DE");
    const bban = gen.value("370400440532013000");
    const options: IbanOptions = { country, bban };
    const mutable = { ...options };
    const identifier = gen.iban(mutable);
    mutable.country = "GB";
    mutable.bban = gen.value("WEST12345698765432");
    expect(await sample(identifier)).toBe("DE89370400440532013000");
    expect(identifier.source).toEqual(["iban", { country, bban }]);
    expect(gen.iban({ country: "DE", bban }).source).not.toEqual(identifier.source);
    expect(gen.iban({ country, bban: gen.value("370400440532013001") }).source).not.toEqual(identifier.source);
  });

  it("preserves the existing seeded random numeric BBAN behavior", async () => {
    expect(await sample(gen.iban("DE"))).toBe("DE23317861912202758020");
    expect(await sample(gen.iban())).toBe("DE23317861912202758020");
    expect(gen.iban("DE").source).toEqual(["iban", "DE"]);
    expect(await sample(gen.iban("GB"))).toBe("GB05317861912202758020");
    await expect(sample(gen.iban("NO"))).rejects.toThrow("no BBAN length for NO");
  });

  it.each(["", "D", "DEU", "de", "DE\n", "日本"])("rejects malformed supplied country %j", async (country) => {
    await expect(sample(gen.iban({ country, bban: gen.value("370400440532013000") }))).rejects.toThrow("country must contain two uppercase letters");
  });

  it.each(["", "1234567", "0".repeat(31), "0".repeat(17), "0".repeat(19), "a".repeat(18), "0".repeat(17) + "-", "0".repeat(17) + "\n", "0".repeat(17) + " "])("rejects malformed or wrong-length supplied BBAN %j", async (bban) => {
    await expect(sample(gen.iban({ country: "DE", bban: gen.value(bban) }))).rejects.toThrow(/BBAN/u);
  });

  it("rejects generator outputs that violate the string contract", async () => {
    const country = Reflect.apply(gen.iban, undefined, [{ country: gen.value(1), bban: gen.value("370400440532013000") }]);
    await expect(sample(country)).rejects.toThrow("country must contain two uppercase letters");
    const bban = Reflect.apply(gen.iban, undefined, [{ country: "DE", bban: gen.value(1) }]);
    await expect(sample(bban)).rejects.toThrow(/BBAN/u);
  });
});
