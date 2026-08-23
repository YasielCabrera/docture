/**
 * `docture.config.ts` — where the wiring lives when flags stop being enough.
 *
 * The flags cover the common case: one PDF loader, one model, one schema. A config
 * file covers everything else, and it does it by handing you the actual library
 * rather than a description of it — your loaders, your strategies, your model
 * instance, constructed by your imports.
 *
 * ```ts
 * import { defineConfig } from "@docture/cli";
 * import { PdfJsLoader } from "@docture/loader-pdfjs";
 * import { llm } from "@docture/llm";
 * import { openai } from "@ai-sdk/openai";
 * import { Invoice } from "./schemas/invoice.js";
 *
 * export default defineConfig({
 *   loaders: [new PdfJsLoader()],
 *   strategies: [llm({ model: openai("gpt-5") })],
 *   schema: Invoice,
 * });
 * ```
 *
 * That example needs no flags at all: `docture extract invoice.pdf` is the whole
 * command. Anything passed on the command line still wins over what is here — a
 * config is a default, never an override.
 */

import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  Classification,
  Classifier,
  DocumentLoader,
  DocumentConverter,
  Extractor,
  ExtractionStrategy,
  FlexibleSchema,
  RoutingPolicy,
  LayoutAnalyzer,
} from "@docture/core";
import type { PricingTable } from "@docture/llm";
import type { LanguageModel } from "ai";
import { UsageError } from "./cli/errors.js";
import { loadExport } from "./load-module.js";

export interface DoctureConfig {
  /**
   * A fully-built extractor. When present it is used as-is and the wiring options
   * below are ignored — the escape hatch for a pipeline the flags cannot describe.
   */
  readonly extractor?: Extractor | (() => Extractor | Promise<Extractor>);
  /** A fully-built converter used by `docture convert`. */
  readonly converter?:
    | DocumentConverter
    | (() => DocumentConverter | Promise<DocumentConverter>);

  readonly loaders?: readonly DocumentLoader[];
  /** Given these, the CLI builds no strategies of its own and `--model` is unused. */
  readonly strategies?: readonly ExtractionStrategy[];
  readonly classifiers?: readonly Classifier[];
  readonly classifications?: readonly Classification[];
  readonly policy?: RoutingPolicy;
  readonly stageTimeoutMs?: number;
  /** Deterministic conversion refinement used unless --assist-layout supplies one. */
  readonly layoutAnalyzer?: LayoutAnalyzer;

  /** Used when `strategies` is absent. A model instance, or a `provider/id` string. */
  readonly model?: LanguageModel;
  /** Also register a vision strategy, for documents with no text layer. */
  readonly vision?: boolean;
  /** USD per million tokens, by model id. Without it, cost is reported as unknown. */
  readonly pricing?: PricingTable;
  /** Appended to the system prompt. */
  readonly instructions?: string;

  /** Used when `--schema` is not passed. */
  readonly schema?: FlexibleSchema;
  /** Cache model responses here. Relative paths resolve against the config file. */
  readonly cacheDir?: string;
  readonly concurrency?: number;
}

/** Identity helper. Exists for the type inference and the import in the example. */
export function defineConfig(config: DoctureConfig): DoctureConfig {
  return config;
}

export interface LoadedConfig {
  readonly config: DoctureConfig;
  /** Absolute path of the file. Relative paths inside the config resolve here. */
  readonly path: string;
}

const FILENAMES = [
  "docture.config.ts",
  "docture.config.mts",
  "docture.config.js",
  "docture.config.mjs",
] as const;

/**
 * Nearest config, walking up from `cwd`.
 *
 * Upward rather than cwd-only so that running the CLI from a subdirectory of a
 * project behaves the way every other tool in that project does.
 */
export async function findConfig(cwd: string): Promise<string | undefined> {
  let directory = resolve(cwd);

  for (;;) {
    for (const name of FILENAMES) {
      const candidate = join(directory, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch {
        // Not here; try the next name, then the parent.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export interface ResolveConfigOptions {
  readonly cwd: string;
  /** `--config`. An explicit path that does not exist is an error, not a miss. */
  readonly explicit?: string;
  /** `--no-config`. */
  readonly disabled?: boolean;
}

export async function resolveConfig(
  options: ResolveConfigOptions,
): Promise<LoadedConfig | undefined> {
  if (options.disabled === true) return undefined;

  const path =
    options.explicit === undefined
      ? await findConfig(options.cwd)
      : isAbsolute(options.explicit)
        ? options.explicit
        : resolve(options.cwd, options.explicit);

  if (path === undefined) return undefined;

  const loaded = await loadExport<DoctureConfig>(path, {
    kind: "config",
    cwd: options.cwd,
    names: ["config"],
  });

  if (typeof loaded.value !== "object" || loaded.value === null) {
    throw new UsageError(
      `"${loaded.from}" must export a config object, got ${typeof loaded.value}.`,
      "Wrap it in `defineConfig({ … })`.",
    );
  }

  return { config: loaded.value, path: loaded.from };
}

/** Resolve a path from a config against the config's own directory, not the cwd. */
export function relativeToConfig(loaded: LoadedConfig | undefined, path: string): string {
  if (isAbsolute(path) || loaded === undefined) return path;
  return resolve(dirname(loaded.path), path);
}
