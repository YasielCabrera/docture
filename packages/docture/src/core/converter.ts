/** Document conversion composition root. */

import { basename, extname } from "node:path";
import type { LayoutAnalyzer } from "./contracts/layout-analyzer.js";
import type { DocumentLoader } from "./contracts/loader.js";
import type { ModelBackend } from "./contracts/model.js";
import { applyLayoutAnnotations, analyzeDocument } from "./conversion/analyze.js";
import { conversionAssets, exportDocument } from "./conversion/export.js";
import type {
  ConversionBatchItem,
  ConversionBatchOptions,
  ConversionResult,
  ConversionWarning,
  ConvertOptions,
  SafeConversion,
} from "./domain/conversion.js";
import { isLoadedSource, type DocumentSource, type RawDocument } from "./domain/document.js";
import type { LoadedDocument } from "./domain/geometry.js";
import { silentLogger, type Logger } from "./domain/logger.js";
import { sumUsage, type Attempt, type Usage } from "./domain/result.js";
import { withDeadline } from "./pipeline/deadline.js";
import {
  DuplicateComponentError,
  NoConvertibleContentError,
  ModelOutputError,
  TimeoutError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./pipeline/errors.js";
import { documentFeatures, preloadedFeatures } from "./pipeline/features.js";
import { loadDocument } from "./pipeline/read.js";
import { resolveSource } from "./pipeline/source.js";

export interface DocumentConverterOptions {
  /** Tried in order; the first eligible loader that succeeds wins. */
  readonly loaders?: readonly DocumentLoader[];
  /** Optional refinement applied after deterministic layout analysis. */
  readonly layoutAnalyzer?: LayoutAnalyzer;
  readonly logger?: Logger;
  /** Per-stage deadline in ms. Omit for none. */
  readonly stageTimeoutMs?: number;
}

interface LoadedConversion {
  readonly document: LoadedDocument;
  readonly raw?: RawDocument;
  readonly loader: string;
  readonly attempts: readonly Attempt[];
  readonly features: ReturnType<typeof documentFeatures>;
  readonly fileName?: string;
}

function safeStem(fileName: string | undefined): string {
  if (fileName === undefined) return "document";
  const name = basename(fileName);
  const stem = name.slice(0, Math.max(0, name.length - extname(name).length));
  const safe = stem.replace(/[\u0000-\u001f\u007f]/gu, "-");
  return safe || "document";
}

function usageFrom(partial: Partial<Usage> | undefined): Usage {
  const inputTokens = partial?.inputTokens ?? 0;
  const outputTokens = partial?.outputTokens ?? 0;
  return sumUsage([{
    ...partial,
    totalTokens: partial?.totalTokens ?? inputTokens + outputTokens,
  }], partial?.wallMs ?? 0);
}

function failedAttempt(name: string, ms: number, error: unknown): Attempt {
  const code = errorCodeOf(error);
  return {
    strategy: name,
    status: "failed",
    ms,
    error: messageOf(error),
    ...(code === undefined ? {} : { errorCode: code }),
  };
}

function snapshotConvertOptions(options: ConvertOptions): ConvertOptions {
  const { format, assets, signal, logger, stageTimeoutMs, ...extra } = options;
  const fields: { [K in keyof ConvertOptions]-?: ConvertOptions[K] | undefined } = {
    format, assets, signal, logger, stageTimeoutMs,
  };
  return {
    ...extra,
    ...(fields.format === undefined ? {} : { format: fields.format }),
    ...(fields.assets === undefined ? {} : { assets: fields.assets }),
    ...(fields.signal === undefined ? {} : { signal: fields.signal }),
    ...(fields.logger === undefined ? {} : { logger: fields.logger }),
    ...(fields.stageTimeoutMs === undefined ? {} : { stageTimeoutMs: fields.stageTimeoutMs }),
  };
}

export class DocumentConverter {
  #loaders: DocumentLoader[];
  #layoutAnalyzer: LayoutAnalyzer | undefined;
  #logger: Logger;
  #stageTimeoutMs: number | undefined;
  #disposed: Promise<void> | undefined;

  constructor(options: DocumentConverterOptions = {}) {
    this.#loaders = [...(options.loaders ?? [])];
    this.#layoutAnalyzer = options.layoutAnalyzer;
    this.#logger = options.logger ?? silentLogger;
    this.#stageTimeoutMs = options.stageTimeoutMs;
    assertUnique("loader", this.#loaders);
  }

  /** Register loaders in first-success fallback order. */
  loadDocumentLoader(...loaders: readonly DocumentLoader[]): this {
    for (const loader of loaders) {
      if (this.#loaders.some((existing) => existing.name === loader.name)) {
        throw new DuplicateComponentError("loader", loader.name);
      }
      this.#loaders.push(loader);
    }
    return this;
  }

  /** Register the optional post-deterministic layout analyzer. */
  loadLayoutAnalyzer(analyzer: LayoutAnalyzer): this {
    if (this.#layoutAnalyzer !== undefined) {
      throw new DuplicateComponentError("layout analyzer", analyzer.name);
    }
    this.#layoutAnalyzer = analyzer;
    return this;
  }

  /** Register a model backend's constrained layout analyzer. */
  loadLlm(backend: ModelBackend): this {
    if (backend.layout === undefined) {
      throw new TypeError(`Model "${backend.id}" has no layout analyzer.`);
    }
    return this.loadLayoutAnalyzer(backend.layout());
  }

  loadLogger(logger: Logger): this {
    this.#logger = logger;
    return this;
  }

  get components(): {
    readonly loaders: readonly DocumentLoader[];
    readonly layoutAnalyzer?: LayoutAnalyzer;
  } {
    return {
      loaders: [...this.#loaders],
      ...(this.#layoutAnalyzer === undefined ? {} : { layoutAnalyzer: this.#layoutAnalyzer }),
    };
  }

  /** Convert a source to deterministic text, Markdown, or HTML. */
  async convert(
    source: DocumentSource,
    options: ConvertOptions = {},
  ): Promise<ConversionResult> {
    const started = Date.now();
    const signal = options.signal ?? new AbortController().signal;
    const logger = options.logger ?? this.#logger;
    const stageTimeoutMs = options.stageTimeoutMs ?? this.#stageTimeoutMs;
    const format = options.format ?? "markdown";
    const assetMode = options.assets ?? "referenced";
    const loaded = await this.#load(source, logger, signal, stageTimeoutMs, assetMode !== "omit");

    if (loaded.document.text.trim().length === 0) {
      throw new NoConvertibleContentError(loaded.features);
    }

    const deterministic = analyzeDocument(loaded.document);
    let layout = deterministic.document;
    let method = "deterministic";
    const warnings: ConversionWarning[] = [...deterministic.warnings];
    const attempts: Attempt[] = [...loaded.attempts];
    let modelUsage = usageFrom(undefined);

    if (this.#layoutAnalyzer !== undefined) {
      const analyzer = this.#layoutAnalyzer;
      const analyzerStarted = Date.now();
      const deadline = withDeadline(`layout:${analyzer.name}`, stageTimeoutMs, signal);
      try {
        const result = await analyzer.analyze({
          document: layout,
          signal: deadline.signal,
          logger: logger.child({ layoutAnalyzer: analyzer.name }),
        });
        const applied = applyLayoutAnnotations(layout, result.annotations);
        modelUsage = usageFrom(result.usage);
        if (applied.valid) {
          layout = applied.document;
          method = `deterministic+${analyzer.name}`;
          warnings.push(...(result.warnings ?? []));
          attempts.push({
            strategy: analyzer.name,
            status: "ok",
            ms: Date.now() - analyzerStarted,
            usage: modelUsage,
          });
        } else {
          const reason = applied.reason ?? "invalid analyzer output";
          warnings.push({
            code: "INVALID_LAYOUT_ANALYSIS",
            message: `Layout analyzer "${analyzer.name}" was ignored: ${reason}.`,
          });
          attempts.push({
            strategy: analyzer.name,
            status: "failed",
            ms: Date.now() - analyzerStarted,
            error: reason,
            usage: modelUsage,
          });
        }
      } catch (error) {
        const failedUsage = error instanceof ModelOutputError ? error.usage : undefined;
        const failure = deadline.expired()
          ? new TimeoutError(`layout:${analyzer.name}`, stageTimeoutMs ?? 0)
          : error;
        if (isAbortError(failure)) throw failure;
        modelUsage = usageFrom(failedUsage);
        warnings.push({
          code: "LAYOUT_ANALYZER_FAILED",
          message: `Layout analyzer "${analyzer.name}" failed; deterministic layout was kept: ${messageOf(failure)}.`,
        });
        attempts.push({
          ...failedAttempt(analyzer.name, Date.now() - analyzerStarted, failure),
          ...(failedUsage === undefined ? {} : { usage: failedUsage }),
        });
      } finally {
        deadline.release();
      }
    }

    const stem = safeStem(loaded.fileName);
    const normalizedAssets = conversionAssets(loaded.document, `${stem}.assets`, assetMode);
    const exported = exportDocument(layout, format, assetMode, normalizedAssets.assets);
    warnings.push(...normalizedAssets.warnings, ...exported.warnings);

    return {
      content: exported.content,
      format,
      mimeType: exported.mimeType,
      pages: exported.pages,
      assets: exported.assets,
      loader: loaded.loader,
      method,
      attempts,
      warnings,
      features: loaded.features,
      usage: { ...modelUsage, wallMs: Date.now() - started },
    };
  }

  /** `convert` without the throw. */
  async safeConvert(
    source: DocumentSource,
    options?: ConvertOptions,
  ): Promise<SafeConversion> {
    try {
      return { ok: true, result: await this.convert(source, options) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Convert many documents, yielding each result as it finishes.
   * Early exit aborts and awaits in-flight jobs. A job that ignores cancellation
   * delays the return until it settles.
   */
  async *convertBatch(
    sources: readonly DocumentSource[],
    options?: ConversionBatchOptions,
  ): AsyncGenerator<ConversionBatchItem, void, undefined> {
    const limit = Math.max(1, options?.concurrency ?? 4);
    const controller = new AbortController();
    const snapshot = snapshotConvertOptions(options ?? {});
    const callerSignal = snapshot.signal;
    const signal = callerSignal === undefined
      ? controller.signal
      : AbortSignal.any([callerSignal, controller.signal]);
    const jobOptions = { ...snapshot, signal };
    let next = 0;
    const inFlight = new Map<number, Promise<ConversionBatchItem>>();

    const start = (index: number): void => {
      const source = sources[index];
      if (source === undefined) return;
      inFlight.set(
        index,
        this.safeConvert(source, jobOptions).then((outcome) => ({ source, index, outcome })),
      );
    };

    try {
      while (next < sources.length && inFlight.size < limit) start(next++);
      while (inFlight.size > 0) {
        const item = await Promise.race(inFlight.values());
        inFlight.delete(item.index);
        yield item;
        if (next < sources.length) start(next++);
      }
    } finally {
      controller.abort(new DOMException("Batch consumer stopped", "AbortError"));
      await Promise.allSettled(inFlight.values());
    }
  }

  /** Release every loader and analyzer. Idempotent. */
  dispose(): Promise<void> {
    this.#disposed ??= (async () => {
      const components = [
        ...this.#loaders,
        ...(this.#layoutAnalyzer === undefined ? [] : [this.#layoutAnalyzer]),
      ];
      const disposables = components.filter(
        (component): component is typeof component & { dispose(): Promise<void> } =>
          typeof component.dispose === "function",
      );
      const results = await Promise.allSettled(disposables.map((component) => component.dispose()));
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} component(s) failed to dispose.`);
      }
    })();
    return this.#disposed;
  }

  async #load(
    source: DocumentSource,
    logger: Logger,
    signal: AbortSignal,
    stageTimeoutMs: number | undefined,
    requestAssets: boolean,
  ): Promise<LoadedConversion> {
    if (isLoadedSource(source)) {
      return {
        document: source.loaded,
        loader: source.loaded.loader,
        attempts: [{ strategy: source.loaded.loader, status: "ok", ms: 0 }],
        features: preloadedFeatures(source),
        ...(source.fileName === undefined ? {} : { fileName: source.fileName }),
      };
    }
    if (this.#loaders.length === 0) {
      throw new TypeError(
        "This DocumentConverter has no loader. Call loadDocumentLoader(...) before converting.",
      );
    }
    const raw = await resolveSource(source, signal);
    const read = await loadDocument(this.#loaders, raw, logger, signal, stageTimeoutMs, {
      layout: true,
      assets: requestAssets,
    });
    return {
      document: read.document,
      raw,
      loader: read.loader.name,
      attempts: read.attempts,
      features: documentFeatures(
        read.document,
        read.loader,
        raw.mimeType ?? "application/octet-stream",
      ),
      ...(raw.fileName === undefined ? {} : { fileName: raw.fileName }),
    };
  }
}

function assertUnique(kind: string, named: readonly { readonly name: string }[]): void {
  const seen = new Set<string>();
  for (const item of named) {
    if (seen.has(item.name)) throw new DuplicateComponentError(kind, item.name);
    seen.add(item.name);
  }
}

export function createDocumentConverter(options: DocumentConverterOptions): DocumentConverter {
  if ((options.loaders ?? []).length === 0) {
    throw new TypeError("createDocumentConverter needs at least one loader.");
  }
  return new DocumentConverter(options);
}
