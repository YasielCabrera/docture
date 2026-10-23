/**
 * Turning flags and a config into an `Extractor`.
 *
 * One place decides what the pipeline is, so `extract`, `classify` and `eval` can
 * never disagree about what `--vision` means. The precedence is the same
 * everywhere and there are only three levels:
 *
 *   a flag you passed  →  the config file  →  the built-in default
 *
 * The built-in default is deliberately thin: `DocumentLoaderPdfJs`, plus an `LlmStrategy`
 * around whatever `--model` names. Everything past that is a config file, because
 * a CLI flag for "which of my four deterministic parsers runs first" is a worse
 * version of a TypeScript file.
 */

import {
  createDocumentConverter,
  createExtractor,
  withRasterizer,
  type Classification,
  type CompletionStrategy,
  type Classifier,
  type DocumentLoader,
  type ExtractionStrategy,
  type Rasterizer,
  type LayoutAnalyzer,
} from "docture";
import {
  fileCache,
  llm,
  llmClassifier,
  llmLayout,
  vision,
  type LlmCache,
  type PricingTable,
} from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import type { LanguageModel } from "ai";
import { CliError, UsageError } from "./cli/errors.js";
import type { Io } from "./cli/io.js";
import {
  relativeToConfig,
  type CliConverter,
  type CliExtractor,
  type LoadedConfig,
} from "./config.js";
import { loadExport } from "./load-module.js";
import { resolveModel } from "./model.js";

/** The flags that shape a pipeline, already parsed and validated. */
export interface WiringFlags {
  readonly model?: string;
  readonly gateway?: boolean;
  readonly pricingPath?: string;
  readonly cacheDir?: string;
  readonly instructions?: string;
  readonly temperature?: number;
  readonly vision?: boolean;
  readonly dpi?: number;
  readonly maxPages?: number;
  readonly completion?: CompletionStrategy;
  readonly maxChars?: number;
  readonly timeoutMs?: number;
  readonly classify?: boolean;
  readonly assistLayout?: boolean;
  readonly classificationsPath?: string;
}

export interface WiringInput {
  readonly io: Io;
  readonly config?: LoadedConfig;
  readonly flags: WiringFlags;
  /** `inspect` reads documents and never calls a model. */
  readonly needsModel: boolean;
  /** Extra strategies to run first. `inspect` uses this for its probe. */
  readonly before?: readonly ExtractionStrategy[];
  /**
   * Build from `loaders`/`strategies` even when the config supplies a whole
   * `extractor`.
   *
   * `inspect` needs this: a built `Extractor` cannot be asked what its loaders are
   * and cannot be given a probe strategy, so honouring one would mean the command
   * has nothing to run. Ignoring it is said out loud rather than assumed.
   */
  readonly ignoreSuppliedExtractor?: boolean;
}

export interface Wiring {
  readonly extractor: CliExtractor;
  readonly classifications: readonly Classification[];
  /**
   * Empty when nothing can produce a verdict. `undefined` when the config handed
   * over a built extractor, which cannot be asked what is inside it.
   */
  readonly classifiers?: readonly string[];
  readonly concurrency: number;
  /** What was wired, for `--verbose`. */
  readonly notes: readonly string[];
  /** Likely misconfigurations, printed whether or not `--verbose` is on. */
  readonly warnings: readonly string[];
  dispose(): Promise<void>;
}

export interface ConversionWiring {
  readonly converter: CliConverter;
  readonly concurrency: number;
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
  dispose(): Promise<void>;
}

export interface ConversionWiringInput {
  readonly io: Io;
  readonly config?: LoadedConfig;
  readonly flags: WiringFlags;
}

/** Only a PDF renderer is bundled, so only a PDF loader is worth composing one onto. */
function rendersPdfs(loader: DocumentLoader): boolean {
  return loader.capabilities.mimeTypes.some((m) => m === "application/pdf" || m === "*/*");
}

async function loadRasterizer(dpi: number | undefined): Promise<Rasterizer> {
  try {
    await import("@napi-rs/canvas");
    const { NapiCanvasRasterizer } = await import("docture/raster/canvas");
    return new NapiCanvasRasterizer(dpi === undefined ? {} : { dpi });
  } catch (error) {
    throw new CliError(
      "Rendering pages needs @napi-rs/canvas, which is not available here.",
      "Install it: `npm i @napi-rs/canvas@1.0.10`. It is an optional dependency because it " +
        "carries the one native binding in the tree.",
      { cause: error },
    );
  }
}

async function loadPricing(
  path: string | undefined,
  config: LoadedConfig | undefined,
  cwd: string,
): Promise<PricingTable | undefined> {
  if (path === undefined) return config?.config.pricing;
  const loaded = await loadExport<PricingTable>(path, { kind: "pricing", cwd, names: ["pricing"] });
  if (typeof loaded.value !== "object" || loaded.value === null) {
    throw new UsageError(`"${loaded.from}" must be an object of model id → pricing.`);
  }
  return loaded.value;
}

async function loadClassifications(
  path: string | undefined,
  config: LoadedConfig | undefined,
  cwd: string,
): Promise<readonly Classification[]> {
  if (path === undefined) return config?.config.classifications ?? [];

  const loaded = await loadExport<readonly Classification[] | Record<string, Classification>>(
    path,
    { kind: "classifications", cwd, names: ["classifications"] },
  );
  // A module of `export const invoice = defineClassification(…)` is at least as
  // natural as an array, so both are accepted and normalised here.
  const list: readonly unknown[] = Array.isArray(loaded.value)
    ? loaded.value
    : Object.values(loaded.value);

  const wellFormed = list.every(
    (c): c is Classification =>
      typeof c === "object" && c !== null && typeof (c as Classification).name === "string",
  );
  if (!wellFormed || list.length === 0) {
    throw new UsageError(
      `"${loaded.from}" must export classifications built with defineClassification().`,
    );
  }
  return list;
}

export async function buildWiring(input: WiringInput): Promise<Wiring> {
  const { flags, config, io } = input;
  const notes: string[] = [];
  const warnings: string[] = [];
  const cwd = io.cwd;

  if (config !== undefined) notes.push(`config ${config.path}`);

  const classifications = await loadClassifications(flags.classificationsPath, config, cwd);
  const concurrency = config?.config.concurrency ?? 4;

  // 1. A config that hands over a whole extractor owns the pipeline outright.
  const supplied = input.ignoreSuppliedExtractor === true ? undefined : config?.config.extractor;
  if (config?.config.extractor !== undefined && supplied === undefined) {
    warnings.push(
      "The config's `extractor` cannot be used here — a built extractor has no loaders to " +
        "read back. Falling back to its `loaders`, or to pdfjs.",
    );
  }
  if (supplied !== undefined) {
    const extractor = typeof supplied === "function" ? await supplied() : supplied;
    notes.push("extractor from config — flags describing the pipeline are ignored");
    if (flags.model !== undefined) {
      warnings.push("--model is ignored: the config supplies a built extractor.");
    }
    return {
      extractor,
      classifications,
      concurrency,
      notes,
      warnings,
      dispose: () => extractor.dispose(),
    };
  }

  // 2. Loaders.
  const configured = config?.config.loaders;
  let loaders: readonly DocumentLoader[] = configured ?? [new DocumentLoaderPdfJs()];
  notes.push(
    configured === undefined
      ? "loaders [pdfjs] (default)"
      : `loaders [${configured.map((l) => l.name).join(", ")}] from config`,
  );

  const wantsVision = flags.vision === true || config?.config.vision === true;
  if (wantsVision) {
    const rasterizer = await loadRasterizer(flags.dpi);
    loaders = loaders.map((loader) =>
      loader.capabilities.images === true || !rendersPdfs(loader)
        ? loader
        : withRasterizer(loader, rasterizer),
    );
    notes.push(
      `rasterizer ${rasterizer.name}${flags.dpi === undefined ? "" : ` at ${flags.dpi} dpi`}`,
    );
  }

  // 3. Strategies. A config's list replaces ours entirely; otherwise whatever model
  //    was named — on the command line, or in the config — becomes an LlmStrategy.
  const cacheDir = flags.cacheDir ?? configCacheDir(config);
  const pricing = await loadPricing(flags.pricingPath, config, cwd);
  const cache: LlmCache | undefined = cacheDir === undefined ? undefined : fileCache(cacheDir);
  if (cacheDir !== undefined) notes.push(`cache ${cacheDir}`);

  const classifiers: Classifier[] = [...(config?.config.classifiers ?? [])];
  const fromConfig: readonly ExtractionStrategy[] = config?.config.strategies ?? [];

  /**
   * A model is worth resolving for two independent reasons — building the default
   * strategies, and building the classifier `--classify` asks for. A config that
   * supplies its own strategies removes the first reason but NOT the second, which
   * is the whole of what `docture classify` needs.
   */
  const modelWouldBeUsed = fromConfig.length === 0 || flags.classify === true;
  const model = modelWouldBeUsed
    ? await chooseModel(flags, config, io, notes, warnings)
    : undefined;

  const instructions = flags.instructions ?? config?.config.instructions;
  const shared = {
    ...(instructions === undefined ? {} : { instructions }),
    ...(cache === undefined ? {} : { cache }),
    ...(pricing === undefined ? {} : { pricing }),
    ...(flags.temperature === undefined ? {} : { temperature: flags.temperature }),
  };

  let strategies: readonly ExtractionStrategy[] = fromConfig;

  if (fromConfig.length > 0) {
    notes.push(`strategies [${fromConfig.map((s) => s.name).join(", ")}] from config`);
    // Never let someone believe `--model` drove an extraction it had no part in.
    if (flags.model !== undefined) {
      warnings.push(
        flags.classify === true
          ? "--model is used for classification only: the config supplies its own strategies."
          : "--model is ignored: the config supplies its own strategies.",
      );
    }
  } else if (model !== undefined) {
    strategies = [
      llm({
        model,
        ...shared,
        ...(flags.completion === undefined ? {} : { completion: flags.completion }),
        ...(flags.maxChars === undefined ? {} : { maxCharsPerRequest: flags.maxChars }),
      }),
      ...(wantsVision
        ? [
            vision({
              model,
              ...shared,
              ...(flags.dpi === undefined ? {} : { dpi: flags.dpi }),
              ...(flags.maxPages === undefined ? {} : { maxPages: flags.maxPages }),
            }),
          ]
        : []),
    ];
  }

  if (flags.classify === true && model !== undefined) {
    classifiers.push(llmClassifier({ model, ...shared }));
    notes.push("classifier llm");
  }

  if (input.needsModel && strategies.length === 0) {
    throw new UsageError(
      "Nothing is wired that could extract anything.",
      "Pass --model <provider>/<model-id>, or declare `strategies` in docture.config.ts.",
    );
  }
  if (flags.classify === true && classifications.length === 0) {
    warnings.push(
      "--classify has no candidate kinds, so the verdict can only be UNKNOWN. " +
        "Pass --classifications <path>.",
    );
  }

  const stageTimeoutMs = flags.timeoutMs ?? config?.config.stageTimeoutMs;
  const extractor = createExtractor({
    loaders,
    strategies: [...(input.before ?? []), ...strategies],
    ...(classifiers.length === 0 ? {} : { classifiers }),
    ...(classifications.length === 0 ? {} : { classifications }),
    ...(config?.config.policy === undefined ? {} : { policy: config.config.policy }),
    ...(stageTimeoutMs === undefined ? {} : { stageTimeoutMs }),
  });

  return {
    extractor,
    classifications,
    classifiers: classifiers.map((c) => c.name),
    concurrency,
    notes,
    warnings,
    dispose: () => extractor.dispose(),
  };
}

/** Build the conversion peer from the same loader, model, cache, and timeout rules. */
export async function buildConversionWiring(
  input: ConversionWiringInput,
): Promise<ConversionWiring> {
  const { config, flags, io } = input;
  const notes: string[] = [];
  const warnings: string[] = [];
  if (config !== undefined) notes.push(`config ${config.path}`);

  const supplied = config?.config.converter;
  if (supplied !== undefined) {
    const converter = typeof supplied === "function" ? await supplied() : supplied;
    notes.push("converter from config");
    if (flags.model !== undefined || flags.assistLayout === true) {
      warnings.push(
        "--model and --assist-layout are ignored because the config supplies a built converter.",
      );
    }
    return {
      converter,
      concurrency: config?.config.concurrency ?? 4,
      notes,
      warnings,
      dispose: () => converter.dispose(),
    };
  }

  const loaders = config?.config.loaders ?? [new DocumentLoaderPdfJs()];
  notes.push(
    config?.config.loaders === undefined
      ? "loaders [pdfjs] (default)"
      : `loaders [${loaders.map((loader) => loader.name).join(", ")}] from config`,
  );

  let layoutAnalyzer: LayoutAnalyzer | undefined = config?.config.layoutAnalyzer;
  if (flags.assistLayout === true) {
    const model = await chooseModel(flags, config, io, notes, warnings);
    if (model === undefined) {
      throw new UsageError(
        "--assist-layout needs a model.",
        "Pass --model <provider>/<model-id>, or set `model` in docture.config.ts.",
      );
    }
    const cacheDir = flags.cacheDir ?? configCacheDir(config);
    const cache = cacheDir === undefined ? undefined : fileCache(cacheDir);
    const pricing = await loadPricing(flags.pricingPath, config, io.cwd);
    const instructions = flags.instructions ?? config?.config.instructions;
    layoutAnalyzer = llmLayout({
      model,
      ...(cache === undefined ? {} : { cache }),
      ...(pricing === undefined ? {} : { pricing }),
      ...(instructions === undefined ? {} : { instructions }),
      ...(flags.temperature === undefined ? {} : { temperature: flags.temperature }),
    });
    if (cacheDir !== undefined) notes.push(`cache ${cacheDir}`);
    notes.push(`layout analyzer ${layoutAnalyzer.name}`);
  } else if (flags.model !== undefined) {
    warnings.push("--model has no effect without --assist-layout.");
  } else if (layoutAnalyzer !== undefined) {
    notes.push(`layout analyzer ${layoutAnalyzer.name} from config`);
  }

  const stageTimeoutMs = flags.timeoutMs ?? config?.config.stageTimeoutMs;
  const converter = createDocumentConverter({
    loaders,
    ...(layoutAnalyzer === undefined ? {} : { layoutAnalyzer }),
    ...(stageTimeoutMs === undefined ? {} : { stageTimeoutMs }),
  });
  return {
    converter,
    concurrency: config?.config.concurrency ?? 4,
    notes,
    warnings,
    dispose: () => converter.dispose(),
  };
}

/** `--model` beats a config's model; neither is an error until someone needs one. */
async function chooseModel(
  flags: WiringFlags,
  config: LoadedConfig | undefined,
  io: Io,
  notes: string[],
  warnings: string[],
): Promise<LanguageModel | undefined> {
  if (flags.model !== undefined) {
    const resolved = await resolveModel(flags.model, {
      cwd: io.cwd,
      env: io.env,
      ...(flags.gateway === true ? { gateway: true } : {}),
    });
    notes.push(`model ${resolved.id} via ${resolved.via}`);
    if (resolved.warning !== undefined) warnings.push(resolved.warning);
    return resolved.model;
  }
  if (config?.config.model !== undefined) {
    notes.push("model from config");
    return config.config.model;
  }
  return undefined;
}

/** A cache directory in a config is relative to the config, not to the shell. */
function configCacheDir(config: LoadedConfig | undefined): string | undefined {
  const dir = config?.config.cacheDir;
  return dir === undefined ? undefined : relativeToConfig(config, dir);
}
