/**
 * `docture.config.ts` — where the wiring lives when flags stop being enough.
 *
 * The flags cover the common case: one PDF loader, one model, one schema. A config
 * file covers everything else, and it does it by handing you the actual library
 * rather than a description of it — your loaders, your strategies, your model
 * instance, constructed by your imports.
 *
 * ```ts
 * import { defineConfig } from "@docture/cli/config";
 * import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
 * import { llm } from "docture/llm";
 * import { openai } from "@ai-sdk/openai";
 * import { Invoice } from "./schemas/invoice.js";
 *
 * export default defineConfig({
 *   loaders: [new DocumentLoaderPdfJs()],
 *   strategies: [llm({ model: openai("gpt-5") })],
 *   schema: Invoice,
 * });
 * ```
 *
 * That example needs no flags at all: `docture extract invoice.pdf` is the whole
 * command. Anything passed on the command line still wins over what is here — a
 * config is a default, never an override.
 */

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
} from "docture";
import type { PricingTable } from "docture/llm";
import type { LanguageModel } from "ai";

/**
 * The extractor methods the CLI calls.
 *
 * Picked rather than the class itself. pnpm installs `docture` once per peer set, so a
 * config's `Extractor` can come from another copy than the CLI's, and a class with
 * private fields only matches its own declaration.
 */
export type CliExtractor = Pick<Extractor, "extract" | "extractBatch" | "classify" | "dispose">;

/** The converter methods the CLI calls, picked for the same reason as {@link CliExtractor}. */
export type CliConverter = Pick<DocumentConverter, "convertBatch" | "dispose">;

export interface DoctureConfig {
  /**
   * A fully-built extractor. When present it is used as-is and the wiring options
   * below are ignored — the escape hatch for a pipeline the flags cannot describe.
   */
  readonly extractor?: CliExtractor | (() => CliExtractor | Promise<CliExtractor>);
  /** A fully-built converter used by `docture convert`. */
  readonly converter?: CliConverter | (() => CliConverter | Promise<CliConverter>);

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

/**
 * Identity helper. Exists for the type inference and the import in the example.
 *
 * @example
 * ```ts
 * import { defineConfig } from "@docture/cli/config";
 *
 * export default defineConfig({ concurrency: 2 });
 * ```
 */
export function defineConfig(config: DoctureConfig): DoctureConfig {
  return config;
}
