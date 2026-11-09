/**
 * `Process` — extracting a bundle that is more than one document.
 *
 * A scanned batch is routinely one PDF holding eleven unrelated things. `Extractor`
 * answers "what is in this document?"; `Process` answers "what documents are in
 * this file, and what is in each of them?".
 *
 * ```ts
 * const process = new Process()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadSplitter(new ImageSplitter({ model: openai("gpt-5") }))
 *   .loadExtractor(extractor);
 *
 * const documents = await process
 *   .loadFile("batch.pdf")
 *   .split([invoice, licence], SplittingStrategy.EAGER)
 *   .extract();
 *
 * for (const document of documents) {
 *   if (document.name === "invoice") document.data.invoiceNumber;  // narrowed
 *   else                             document.data.licenceNumber;  // narrowed
 * }
 * ```
 *
 * `split` is deliberately lazy — it records the plan and returns `this`, so the
 * chain above reads in one breath and only `extract` is awaited. It also carries the
 * classification list into the RETURN TYPE, which is where the payoff is: the result
 * is a discriminated union, so narrowing on `name` narrows `data`.
 */

import type { ClassifiedExtraction } from "./contracts/classifier.js";
import { createDisposalScope, type DisposalScope } from "./contracts/disposal.js";
import { extractionContractOf, type Classification } from "./contracts/classifier.js";
import type { DocumentLoader } from "./contracts/loader.js";
import { mapWithConcurrency, runSplitter, type SplitContext, type Splitter } from "./contracts/splitter.js";
import type { DocumentSource } from "./domain/document.js";
import { isLoadedSource } from "./domain/document.js";
import { SplittingStrategy } from "./domain/enums.js";
import { isContract } from "./domain/contract.js";
import type { LoadedSource } from "./domain/geometry.js";
import type { Logger } from "./domain/logger.js";
import { EMPTY_USAGE, sumUsage, type ClassificationResult, type Usage } from "./domain/result.js";
import { silentLogger } from "./domain/logger.js";
import { hasFact } from "./domain/document.js";
import { UNCLASSIFIED, type DocGroups } from "./domain/split.js";
import { Extractor } from "./extractor.js";
import { MissingComponentError, SplitFailedError, UnclassifiedGroupError } from "./pipeline/errors.js";
import { batchConcurrency } from "./pipeline/batch.js";
import { preloadedFeatures } from "./pipeline/features.js";
import { readDocument } from "./pipeline/read.js";
import { checkedRuleFailureMode, withProcessHints, type RunOptions } from "./pipeline/run.js";
import { resolveSource, type SourceResolver } from "./pipeline/source.js";
import { withCallDeadline } from "./pipeline/abandon.js";
import { isolatedListener } from "./domain/events.js";

export interface ProcessExtractOptions extends RunOptions {
  /**
   * What to do with a group whose classification is not in the list.
   *
   * `"throw"` by default, and deliberately: pages that fell out of a bundle are
   * exactly the ones nobody notices are missing.
   */
  readonly onUnclassified?: "throw" | "skip";
  /**
   * How many documents from the bundle to extract at once. A positive integer,
   * default 4. The first failure cancels the documents still running.
   */
  readonly concurrency?: number;
}

export interface SplitReport {
  readonly splitter: string;
  readonly strategy: SplittingStrategy;
  readonly groups: DocGroups;
  /** What deciding the cut cost. Zero when the splitter used no model. */
  readonly usage: Usage;
}

type Bundle = LoadedSource & { readonly mimeType: string };

export class Process<C extends readonly Classification[] = readonly Classification[]> {
  #loaders: DocumentLoader[] = [];
  readonly #sourceResolver: SourceResolver;

  constructor(options: { readonly sourceResolver?: SourceResolver } = {}) {
    this.#sourceResolver = options.sourceResolver ?? resolveSource;
  }
  #splitter: Splitter | undefined;
  #extractor: Extractor | undefined;
  #source: DocumentSource | undefined;
  #classifications: readonly Classification[] = [];
  #strategy: SplittingStrategy = SplittingStrategy.EAGER;
  #splitPlanned = false;
  #logger: Logger = silentLogger;
  #lastSplit: SplitReport | undefined;
  #disposed: Promise<void> | undefined;

  // ── Wiring ────────────────────────────────────────────────────────────────────

  /**
   * The loader that reads the bundle. Optional when {@link Process.loadExtractor}
   * is set — the extractor's loaders are used, so the bundle is read once and with
   * the same library that extracts from it.
   */
  loadDocumentLoader(...loaders: readonly DocumentLoader[]): this {
    this.#loaders.push(...loaders);
    return this;
  }

  loadSplitter(splitter: Splitter): this {
    this.#splitter = splitter;
    return this;
  }

  /**
   * The extractor used for any classification that does not carry its own.
   *
   * Borrowed: {@link Process.dispose} leaves it to its owner, so one extractor can
   * serve several processes. Loaders and the splitter loaded here are owned.
   */
  loadExtractor(extractor: Extractor): this {
    this.#extractor = extractor;
    return this;
  }

  loadLogger(logger: Logger): this {
    this.#logger = logger;
    return this;
  }

  /** The bundle to work on when `extract()` or `splitOnly()` is called without one. */
  loadFile(source: DocumentSource): this {
    this.#source = source;
    return this;
  }

  /** Alias of {@link Process.loadFile}, for bytes and streams. */
  loadSource(source: DocumentSource): this {
    return this.loadFile(source);
  }

  // ── Planning ──────────────────────────────────────────────────────────────────

  /**
   * Plan a split into these document kinds.
   *
   * Records the plan and returns immediately — nothing is read and no model is
   * called until {@link Process.extract}. The classification list is captured in the
   * type, so `extract()` returns a discriminated union over exactly these names.
   */
  split<const NC extends readonly Classification[]>(
    classifications: NC,
    strategy: SplittingStrategy = SplittingStrategy.EAGER,
  ): Process<NC> {
    this.#classifications = classifications;
    this.#strategy = strategy;
    this.#splitPlanned = true;
    return this as unknown as Process<NC>;
  }

  /**
   * How the last completed {@link Process.extract} or {@link Process.splitOnly} cut
   * its bundle. `undefined` before one. With concurrent runs, the last to finish.
   */
  get lastSplit(): SplitReport | undefined {
    return this.#lastSplit;
  }

  // ── Running ───────────────────────────────────────────────────────────────────

  /**
   * Read the bundle, cut it, and extract each document it holds.
   *
   * Without a planned split this extracts the whole file as one document against the
   * single classification given — which is what makes `Process` usable for the
   * one-document case too, rather than a separate code path.
   *
   * A `source` here overrides {@link Process.loadFile} for this call only, so one
   * configured process can work through several files at once.
   */
  extract(source: DocumentSource, options?: ProcessExtractOptions): Promise<ClassifiedExtraction<C>[]>;
  extract(options?: ProcessExtractOptions): Promise<ClassifiedExtraction<C>[]>;
  async extract(
    first?: DocumentSource | ProcessExtractOptions,
    second?: ProcessExtractOptions,
  ): Promise<ClassifiedExtraction<C>[]> {
    const { source, options } = this.#call(first, second, "extract");
    const limit = batchConcurrency(options.concurrency);
    if (options.onRuleFailure !== undefined) checkedRuleFailureMode(options.onRuleFailure);
    return withCallDeadline(options.timeoutMs, options.signal, (signal) => this.#extract(source, options, limit, signal));
  }

  async #extract(
    source: DocumentSource,
    options: ProcessExtractOptions,
    limit: number,
    bounded: AbortSignal | undefined,
  ): Promise<ClassifiedExtraction<C>[]> {
    const signal = bounded ?? new AbortController().signal;
    const logger = options.logger ?? this.#logger;

    const preloaded = await this.#read(source, signal, logger, options);
    const { groups } = await this.#cut(preloaded, signal, logger, options);

    const names = this.#classifications.map((c) => c.name);

    const jobs: { group: DocGroups[number]; classification: Classification }[] = [];
    for (const group of groups) {
      const classification = this.#classifications.find((c) => c.name === group.classification);
      if (classification === undefined) {
        if (options.onUnclassified === "skip") {
          logger.warn("dropping unclassified group", {
            pages: group.pages.join(","),
            classification: group.classification,
          });
          continue;
        }
        throw new UnclassifiedGroupError(group.pages, group.classification, names);
      }
      jobs.push({ group, classification });
    }

    return mapWithConcurrency(jobs, limit, async ({ group, classification }, _index, jobSignal) => {
      const extractor = classification.extractor ?? this.#extractor;
      if (extractor === undefined) {
        throw new MissingComponentError(
          `No extractor for "${classification.name}". Call loadExtractor(...) on the ` +
            "Process, or give the classification its own `extractor`.",
        );
      }

      const contract = extractionContractOf(classification);
      const hints = classification.hints ?? (isContract(contract) ? contract.hints : undefined);
      const examples = classification.examples ?? (isContract(contract) ? contract.examples : undefined);
      const decided: ClassificationResult = {
        name: classification.name,
        confidence: group.confidence ?? 1,
        signals: [],
      };
      const result = await extractor.extractResult(preloaded, contract, withProcessHints({
        ...withoutCallDeadline(options),
        pages: group.pages,
        signal: jobSignal,
        logger,
      }, hints, { owner: `classification "${classification.name}"`, examples, classification: decided }));

      return {
        name: classification.name,
        data: result.data,
        result,
        pages: group.pages,
      } as ClassifiedExtraction<C>;
    }, signal);
  }

  /**
   * Cut the bundle and report the groups, without extracting anything.
   *
   * Useful on its own: "which pages are the invoice?" is a question worth being able
   * to answer before paying to extract forty of them. A `source` here overrides
   * {@link Process.loadFile} for this call only.
   */
  splitOnly(source: DocumentSource, options?: RunOptions): Promise<SplitReport>;
  splitOnly(options?: RunOptions): Promise<SplitReport>;
  async splitOnly(first?: DocumentSource | RunOptions, second?: RunOptions): Promise<SplitReport> {
    const { source, options } = this.#call(first, second, "splitOnly");
    return withCallDeadline(options.timeoutMs, options.signal, async (bounded) => {
      const signal = bounded ?? new AbortController().signal;
      const logger = options.logger ?? this.#logger;
      return this.#cut(await this.#read(source, signal, logger, options), signal, logger, options);
    });
  }

  /** Release the splitter and the loaders loaded here. The extractor is borrowed. Idempotent. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  dispose(scope: DisposalScope = createDisposalScope()): Promise<void> {
    this.#disposed ??= scope.dispose(
      ...(this.#splitter === undefined ? [] : [this.#splitter]),
      ...this.#loaders,
    );
    return this.#disposed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  #call<O extends RunOptions>(
    first: DocumentSource | O | undefined,
    second: O | undefined,
    method: "extract" | "splitOnly",
  ): { source: DocumentSource; options: O } {
    const passed = second !== undefined || (first !== undefined && !isOptionsBag(first));
    const source = passed && first !== undefined ? (first as DocumentSource) : this.#source;
    if (source === undefined) {
      throw new MissingComponentError(
        `Process has no file. Pass one to ${method}(source), or call loadFile(...) before ${method}().`,
      );
    }
    return { source, options: (passed ? second : first as O | undefined) ?? ({} as O) };
  }

  async #read(
    source: DocumentSource,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<Bundle> {
    if (isLoadedSource(source)) {
      return { ...source, mimeType: source.mimeType ?? "application/octet-stream" };
    }

    const loaders = this.#loaders.length > 0 ? this.#loaders : this.#extractor?.components.loaders;
    if (loaders === undefined || loaders.length === 0) {
      throw new MissingComponentError(
        "Process has no loader. Call loadDocumentLoader(...), or loadExtractor(...) with one wired.",
      );
    }

    const raw = await this.#sourceResolver(source, signal);
    const started = Date.now();
    const read = await readDocument(loaders, raw, logger, signal, options.stageTimeoutMs);
    isolatedListener(options.onEvent, logger)({
      type: "load", loader: read.loader.name, pages: read.document.pages.length, ms: Date.now() - started,
    });
    const facts = read.loader.capabilities.facts;
    return {
      loaded: read.document,
      mimeType: raw.mimeType ?? "application/octet-stream",
      ...(raw.fileName === undefined ? {} : { fileName: raw.fileName }),
      ...(facts === undefined ? {} : { facts }),
    };
  }

  /**
   * What to call a bundle that turned out to be one page.
   *
   * With one candidate there is nothing to decide. With several, the question is a
   * classification rather than a split, so it is answered by the machinery that
   * already exists for it — and the pages are handed over already read.
   */
  async #nameSinglePage(
    bundle: LoadedSource,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<{ readonly classification: string; readonly confidence?: number }> {
    const only = this.#classifications[0];
    if (only !== undefined && this.#classifications.length === 1) return { classification: only.name };

    const extractor = this.#extractor;
    if (extractor === undefined || extractor.components.classifiers.length === 0) {
      return { classification: UNCLASSIFIED };
    }

    const verdict = await extractor.classify(bundle, this.#classifications, {
      ...withoutCallDeadline(options),
      signal,
      logger,
    });
    return { classification: verdict.name, confidence: verdict.confidence };
  }

  async #cut(
    bundle: Bundle,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<SplitReport> {
    signal.throwIfAborted();
    const document = bundle.loaded;
    if (!this.#splitPlanned) {
      throw new SplitFailedError(
        "no split was planned. Call split([...]) before extract(), or use an Extractor " +
          "directly for a file that holds one document",
      );
    }

    // Nothing to split: a document of one page has no seams, so requiring a splitter
    // for it would make a one-page invoice in a batch of bundles fail on wiring.
    if (document.pages.length <= 1) {
      const groups: DocGroups = [
        {
          pages: document.pages.map((page) => page.pageNumber),
          ...await this.#nameSinglePage(bundle, signal, logger, options),
        },
      ];
      signal.throwIfAborted();
      this.#lastSplit = { splitter: "none", strategy: this.#strategy, groups, usage: EMPTY_USAGE };
      return this.#lastSplit;
    }

    const splitter = this.#splitter;
    if (splitter === undefined) {
      throw new SplitFailedError("no splitter is loaded. Call loadSplitter(...) before split()");
    }

    // A splitter that needs page images must not be handed a text-only document and
    // discover it forty pages in. Features come from what the pages actually carry,
    // which is the stricter reading than whatever the loader claims it can do.
    const features = preloadedFeatures(bundle);
    const missing = (splitter.requires ?? []).filter((fact) => !hasFact(features, fact));
    if (missing.length > 0) {
      throw new SplitFailedError(`${splitter.name} needs ${missing.join(", ")}`, [
        { name: splitter.name, reason: `document lacks ${missing.join(", ")}`, missing },
      ]);
    }

    const started = Date.now();
    let usage: Usage = EMPTY_USAGE;
    const ctx: SplitContext = {
      classifications: this.#classifications,
      signal,
      logger,
      ...(bundle.fileName === undefined ? {} : { documentLabel: bundle.fileName }),
      recordUsage: (part) => {
        usage = sumUsage([usage, part], usage.wallMs);
      },
    };

    const groups = await runSplitter(splitter, document.pages, this.#strategy, ctx);
    signal.throwIfAborted();
    const report: SplitReport = {
      splitter: splitter.name,
      strategy: this.#strategy,
      groups,
      usage: { ...usage, wallMs: Date.now() - started },
    };
    this.#lastSplit = report;
    logger.info("split", { splitter: splitter.name, groups: String(groups.length) });
    return report;
  }
}

function withoutCallDeadline<O extends RunOptions>(options: O): O {
  if (options.timeoutMs === undefined) return options;
  const copy: { -readonly [K in keyof O]: O[K] } = { ...options };
  delete copy.timeoutMs;
  return copy;
}

/**
 * Every object `DocumentSource` is binary data, a URL, a `RawDocument` (`bytes`) or a
 * `LoadedSource` (`loaded`). Tags rather than `instanceof` also recognise them from another realm.
 */
function isOptionsBag(value: DocumentSource | RunOptions): value is RunOptions {
  if (typeof value !== "object" || value === null || ArrayBuffer.isView(value)) return false;
  if (SOURCE_TAGS.has(Object.prototype.toString.call(value))) return false;
  return !("bytes" in value) && !("loaded" in value);
}

const SOURCE_TAGS = new Set(["[object ArrayBuffer]", "[object SharedArrayBuffer]", "[object URL]"]);
