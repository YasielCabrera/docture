import type { DocumentFact } from "./domain/document.js";
import type { DocumentLoader } from "./contracts/loader.js";
import type { ExtractionStrategy } from "./contracts/strategy.js";
import { createExtractor, type Extractor, type ExtractorOptions } from "./extractor.js";

type FactCapability = { TEXT_LAYER: "text"; GEOMETRY: "geometry"; RENDERABLE_PAGES: "images" };

type MissingFact<L extends readonly DocumentLoader[], F extends DocumentFact> =
  string extends F ? never : F extends keyof FactCapability
    ? true extends L[number]["capabilities"][FactCapability[F]] ? never : F
    : never;

type MissingRequirements<L extends readonly DocumentLoader[], R extends readonly DocumentFact[]> =
  number extends R["length"] ? never
    : R extends readonly [infer F extends DocumentFact, ...infer Tail extends readonly DocumentFact[]]
      ? MissingFact<L, F> | MissingRequirements<L, Tail> : never;

type MissingStrategies<L extends readonly DocumentLoader[], S extends readonly ExtractionStrategy[]> =
  S extends readonly [infer Head extends ExtractionStrategy, ...infer Tail extends readonly ExtractionStrategy[]]
    ? (Head extends { readonly requires: infer R extends readonly DocumentFact[] } ? MissingRequirements<L, R> : never) | MissingStrategies<L, Tail>
    : never;

type Compatibility<L extends readonly DocumentLoader[], S extends readonly ExtractionStrategy[]> =
  L extends readonly [] ? { readonly missingLoaderCapability: "at least one loader" }
    : number extends L["length"] ? unknown
      : [MissingStrategies<L, S>] extends [never] ? unknown
        : { readonly missingLoaderCapability: MissingStrategies<L, S> };

/** Check advertised capability feasibility for literal wiring; actual document facts remain runtime checks. */
export function createCheckedExtractor<const L extends readonly DocumentLoader[], const S extends readonly ExtractionStrategy[]>(
  options: Omit<ExtractorOptions, "loaders" | "strategies"> & { readonly loaders: L; readonly strategies: S } & Compatibility<NoInfer<L>, NoInfer<S>>,
): Extractor {
  return createExtractor(options);
}
