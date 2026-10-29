import { MissingEngineError } from "docture";
import type { Faker, LocaleDefinition } from "@faker-js/faker";
import type { GenContext, Generator } from "../generators.js";

/** Supported optional engine of this entry. */
export const ENGINE_RANGES = { "@faker-js/faker": "10.6.0" } as const;

async function loadFaker(): Promise<typeof import("@faker-js/faker")> {
  try {
    return await import("@faker-js/faker");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package '@faker-js\/faker' imported from /u.test(error.message)) {
      throw new MissingEngineError("@faker-js/faker", ENGINE_RANGES["@faker-js/faker"], "@docture/synthetic/faker", { cause: error });
    }
    throw error;
  }
}

/** Faker's default reference date is the wall clock; relative dates such as `faker.date.past()` count back from this instead. */
const REF_DATE = "2025-01-01T00:00:00.000Z";

/**
 * Generators backed by faker in `locale` (`de`, `de-AT`, `en_US`, …), falling back to English.
 * Each generator reseeds faker from its position's own stream before calling `build`,
 * so a value depends only on the seed and its path, never on other fields' draws.
 */
export async function fakerFor(locale: string, options: { readonly refDate?: string } = {}): Promise<<V>(build: (faker: Faker) => V) => Generator<V>> {
  const { Faker, allLocales } = await loadFaker();
  const known: Readonly<Record<string, LocaleDefinition>> = allLocales;
  const code = locale.replace("-", "_");
  if (!Object.hasOwn(known, code) || code === "base") {
    const shown = ["de", "en_US", "es", "fr", "ja", "pt_BR"];
    const total = Object.keys(known).filter((key) => key !== "base").length;
    throw new RangeError(`Unknown faker locale "${locale}". Known locales include ${shown.join(", ")} and ${total - shown.length} more`);
  }
  const chain = [...new Set([code, code.split("_")[0] as string, "en", "base"])].filter((key) => Object.hasOwn(known, key)).map((key) => known[key] as LocaleDefinition);
  const faker = new Faker({ locale: chain });
  const refDate = options.refDate ?? REF_DATE;
  faker.setDefaultRefDate(refDate);
  return <V>(build: (faker: Faker) => V): Generator<V> => ({
    kind: "generator",
    generate(context: GenContext) {
      faker.seed(context.stream.int(0, 2 ** 31 - 1));
      return build(faker);
    },
    source: ["faker", code, refDate, build],
  });
}
