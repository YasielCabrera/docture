import { failedAttempt } from "./pipeline/attempt.js";
import { createDisposalScope, type DisposalScope } from "./contracts/disposal.js";
import { batchConcurrency } from "./pipeline/batch.js";
/** Document conversion composition root. */

import { portableBasename, portableExtension } from "./domain/filename.js";
import type { LayoutAnalyzer } from "./contracts/layout-analyzer.js";
import type { DocumentLoader, LoadRequest } from "./contracts/loader.js";
import type { ModelBackend } from "./contracts/model.js";
import { applyLayoutAnnotations, analyzeDocument, withoutFurniture } from "./conversion/analyze.js";
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
  MissingComponentError,
  TimeoutError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./pipeline/errors.js";
import { documentFeatures, preloadedFeatures } from "./pipeline/features.js";
import { selectPages } from "./pipeline/pages.js";
import { readDocument } from "./pipeline/read.js";
import { exportJsonDocument } from "./conversion/json.js";
import { resolveSource, type SourceResolver } from "./pipeline/source.js";

export interface DocumentConverterOptions {
  /** Local file access is explicit through docture/node or a caller-supplied resolver. */
  readonly sourceResolver?: SourceResolver;
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
  const name = portableBasename(fileName);
  const stem = name.slice(0, Math.max(0, name.length - portableExtension(name).length));
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



function snapshotConvertOptions(options: ConvertOptions): ConvertOptions {
  const { format, pages, assets, signal, logger, stageTimeoutMs, ...extra } = options;
  const fields: { [K in keyof ConvertOptions]-?: ConvertOptions[K] | undefined } = {
    format, pages, assets, signal, logger, stageTimeoutMs,
  };
  return {
    ...extra,
    ...(fields.format === undefined ? {} : { format: fields.format }),
    ...(fields.pages === undefined ? {} : { pages: [...fields.pages] }),
    ...(fields.assets === undefined ? {} : { assets: fields.assets }),
    ...(fields.signal === undefined ? {} : { signal: fields.signal }),
    ...(fields.logger === undefined ? {} : { logger: fields.logger }),
    ...(fields.stageTimeoutMs === undefined ? {} : { stageTimeoutMs: fields.stageTimeoutMs }),
  };
}

/**
 * Convert loaded text and layout into grounded text, Markdown, HTML or versioned JSON.
 *
 * @remarks DocumentConverterOptions configures loaders, an optional layout analyzer, logging and stage deadlines. Asset handling and output format are per-call options.
 * @throws MISSING_COMPONENT for missing wiring; NO_CONVERTIBLE_CONTENT for unreadable scans; loader errors retain their typed codes.
 * @example
 * ```ts
 * import { DocumentConverter, DocumentLoaderData } from "docture";
 * const converter = new DocumentConverter({ loaders: [new DocumentLoaderData()] });
 * ```
 */
export class DocumentConverter {
  #loaders: DocumentLoader[];
  #sourceResolver: SourceResolver;
  #layoutAnalyzer: LayoutAnalyzer | undefined;
  #logger: Logger;
  #stageTimeoutMs: number | undefined;
  #disposed: Promise<void> | undefined;

  constructor(options: DocumentConverterOptions = {}) {
    this.#sourceResolver = options.sourceResolver ?? resolveSource;
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
      throw new MissingComponentError(`Model "${backend.id}" has no layout analyzer.`);
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

  /** Convert a source to text, Markdown, HTML, or versioned JSON. */
  async convert(
    source: DocumentSource,
    options: ConvertOptions = {},
  ): Promise<ConversionResult> {
    const started = Date.now();
    const signal = options.signal ?? new AbortController().signal;
    signal.throwIfAborted();
    const logger = options.logger ?? this.#logger;
    const stageTimeoutMs = options.stageTimeoutMs ?? this.#stageTimeoutMs;
    const format = options.format ?? "markdown";
    const assetMode = options.assets ?? "referenced";
    const pages = options.pages === undefined ? undefined : [...options.pages];
    const loaded = await this.#load(source, logger, signal, stageTimeoutMs, {
      ...(pages === undefined ? {} : { pages }),
      layout: true,
      assets: assetMode !== "omit",
    });
    signal.throwIfAborted();

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
      let returnedUsage: Partial<Usage> | undefined;
      try {
        const result = await analyzer.analyze({
          document: withoutFurniture(layout),
          signal: deadline.signal,
          logger: logger.child({ layoutAnalyzer: analyzer.name }),
          ...(loaded.fileName === undefined ? {} : { documentLabel: loaded.fileName }),
        });
        returnedUsage = result.usage;
        deadline.signal.throwIfAborted();
        const applied = applyLayoutAnnotations(layout, result.annotations);
        modelUsage = usageFrom(result.usage);
        if (applied.valid) {
          layout = applied.document;
          method = `deterministic+${analyzer.name}`;
          warnings.push(...(result.warnings ?? []));
          attempts.push({
            stage: "layout",
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
            stage: "layout",
            strategy: analyzer.name,
            status: "failed",
            ms: Date.now() - analyzerStarted,
            error: reason,
            usage: modelUsage,
          });
        }
      } catch (error) {
        signal.throwIfAborted();
        const failedUsage = returnedUsage ?? (error instanceof ModelOutputError ? error.usage : undefined);
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
          ...failedAttempt("layout", analyzer.name, Date.now() - analyzerStarted, failure),
          ...(failedUsage === undefined ? {} : { usage: failedUsage }),
        });
      } finally {
        deadline.release();
      }
    }

    const stem = safeStem(loaded.fileName);
    const normalizedAssets = conversionAssets(loaded.document, `${stem}.assets`, assetMode);
    warnings.push(...normalizedAssets.warnings);
    const exported = format === "json"
      ? exportJsonDocument({
        document: layout, loader: loaded.loader, method, mode: assetMode,
        assets: normalizedAssets.assets, warnings,
      })
      : exportDocument(layout, format, assetMode, normalizedAssets.assets);
    warnings.push(...exported.warnings);

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
    const limit = batchConcurrency(options?.concurrency);
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
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  dispose(scope: DisposalScope = createDisposalScope()): Promise<void> {
    this.#disposed ??= scope.dispose(
      ...this.#loaders,
      ...(this.#layoutAnalyzer === undefined ? [] : [this.#layoutAnalyzer]),
    );
    return this.#disposed;
  }

  async #load(
    source: DocumentSource,
    logger: Logger,
    signal: AbortSignal,
    stageTimeoutMs: number | undefined,
    request: LoadRequest,
  ): Promise<LoadedConversion> {
    const selected = (document: LoadedDocument): LoadedDocument =>
      request.pages === undefined ? document : selectPages(document, request.pages);
    if (isLoadedSource(source)) {
      const document = selected(source.loaded);
      return {
        document,
        loader: source.loaded.loader,
        attempts: [{ stage: "load", strategy: source.loaded.loader, status: "ok", ms: 0 }],
        features: preloadedFeatures({ ...source, loaded: document }),
        ...(source.fileName === undefined ? {} : { fileName: source.fileName }),
      };
    }
    if (this.#loaders.length === 0) {
      throw new MissingComponentError(
        "This DocumentConverter has no loader. Call loadDocumentLoader(...) before converting.",
      );
    }
    const raw = await this.#sourceResolver(source, signal);
    const read = await readDocument(this.#loaders, raw, logger, signal, stageTimeoutMs, request);
    const document = selected(read.document);
    return {
      document,
      raw,
      loader: read.loader.name,
      attempts: read.attempts,
      features: documentFeatures(
        document,
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
    throw new MissingComponentError("createDocumentConverter needs at least one loader.");
  }
  return new DocumentConverter(options);
}
