import type { Model, Scenario } from "./model.js";
import type { Template } from "./template.js";

/**
 * A rendition from `@docture/synthetic/node`: `digital()`, `scan({ severity })`, `photo(…)` and so on.
 * Typed by shape so this entry stays free of Node and engine imports.
 */
export type SynthRendition =
  | { readonly kind: "digital" }
  | {
      readonly kind: "degrade";
      readonly profile: "scan" | "scan-lq" | "photo" | "fax" | { readonly key: string };
      readonly severity: number;
      readonly dpi?: number;
      readonly output?: "pdf" | "png" | "jpeg";
    };

/** The configuration `docture synth` loads from `docture.synth.ts`. */
export interface SynthConfig<T> {
  readonly model: Model<T>;
  readonly templates: readonly Template<T>[];
  readonly scenarios?: readonly Scenario<T>[];
  /** Seeds `docture synth corpus` renders when `--seeds` is absent. */
  readonly seeds?: readonly (number | string)[];
  /** Default `[digital()]`. */
  readonly renditions?: readonly SynthRendition[];
  /** Corpus directory, relative to the config file. */
  readonly out?: string;
  /** Written into every PDF and part of each case key, so a rebuild is byte-identical. */
  readonly createdAt?: string;
}

/** Type a `docture.synth.ts` config. Identity at runtime. */
export function defineSynthConfig<T>(config: SynthConfig<T>): SynthConfig<T> {
  return config;
}
