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
import { extractionContractOf, type Classification } from "./contracts/classifier.js";
import type { DocumentLoader } from "./contracts/loader.js";
import { runSplitter, type SplitContext, type Splitter } from "./contracts/splitter.js";
import type { DocumentSource } from "./domain/document.js";
import { isLoadedSource } from "./domain/document.js";
import { SplittingStrategy } from "./domain/enums.js";
import { isContract } from "./domain/contract.js";
import type { LoadedDocument } from "./domain/geometry.js";
import type { Logger } from "./domain/logger.js";
import { EMPTY_USAGE, sumUsage, type Usage } from "./domain/result.js";
import { silentLogger } from "./domain/logger.js";
import { hasFact } from "./domain/document.js";
import { UNCLASSIFIED, type DocGroups } from "./domain/split.js";
import { Extractor } from "./extractor.js";
import { MissingComponentError, SplitFailedError, UnclassifiedGroupError } from "./pipeline/errors.js";
import { preloadedFeatures } from "./pipeline/features.js";
import { loadDocument } from "./pipeline/read.js";
import { withProcessHints, type RunOptions } from "./pipeline/run.js";
import { resolveSource } from "./pipeline/source.js";

export interface ProcessExtractOptions extends RunOptions {
  /**
   * What to do with a group whose classification is not in the list.
   *
   * `"throw"` by default, and deliberately: pages that fell out of a bundle are
   * exactly the ones nobody notices are missing.
   */
  readonly onUnclassified?: "throw" | "skip";
  /** How many documents from the bundle to extract at once. Default 4. */
  readonly concurrency?: number;
}

export interface SplitReport {
  readonly splitter: string;
  readonly strategy: SplittingStrategy;
  readonly groups: DocGroups;
  /** What deciding the cut cost. Zero when the splitter used no model. */
  readonly usage: Usage;
}

export class Process<C extends readonly Classification[] = readonly Classification[]> {
  #loaders: DocumentLoader[] = [];
  #splitter: Splitter | undefined;
  #extractor: Extractor | undefined;
  #source: DocumentSource | undefined;
  #classifications: readonly Classification[] = [];
  #strategy: SplittingStrategy = SplittingStrategy.EAGER;
  #splitPlanned = false;
  #logger: Logger = silentLogger;
  #lastSplit: SplitReport | undefined;

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

  /** The extractor used for any classification that does not carry its own. */
  loadExtractor(extractor: Extractor): this {
    this.#extractor = extractor;
    return this;
  }

  loadLogger(logger: Logger): this {
    this.#logger = logger;
    return this;
  }

  /** The bundle to work on. */
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

  /** How the last {@link Process.extract} cut the bundle. `undefined` before one. */
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
   */
  async extract(options: ProcessExtractOptions = {}): Promise<ClassifiedExtraction<C>[]> {
    const source = this.#source;
    if (source === undefined) {
      throw new MissingComponentError("Process has no file. Call loadFile(...) before extract().");
    }

    const signal = options.signal ?? new AbortController().signal;
    const logger = options.logger ?? this.#logger;

    const { document, mimeType } = await this.#read(source, signal, logger, options);
    const groups = await this.#cut(document, mimeType, signal, logger, options);

    const preloaded = { loaded: document, mimeType };
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

    const limit = Math.max(1, options.concurrency ?? 4);
    const results = new Array<ClassifiedExtraction<C>>(jobs.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const index = next;
        next += 1;
        const job = jobs[index];
        if (job === undefined) continue;
        signal.throwIfAborted();

        const extractor = job.classification.extractor ?? this.#extractor;
        if (extractor === undefined) {
          throw new MissingComponentError(
            `No extractor for "${job.classification.name}". Call loadExtractor(...) on the ` +
              "Process, or give the classification its own `extractor`.",
          );
        }

        const contract = extractionContractOf(job.classification);
        const hints = job.classification.hints ?? (isContract(contract) ? contract.hints : undefined);
        const result = await extractor.extractResult(preloaded, contract, withProcessHints({
          ...options,
          pages: job.group.pages,
          signal,
          logger,
        }, hints));

        results[index] = {
          name: job.classification.name,
          data: result.data,
          result,
          pages: job.group.pages,
        } as ClassifiedExtraction<C>;
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
  }

  /**
   * Cut the bundle and report the groups, without extracting anything.
   *
   * Useful on its own: "which pages are the invoice?" is a question worth being able
   * to answer before paying to extract forty of them.
   */
  async splitOnly(options: RunOptions = {}): Promise<SplitReport> {
    const source = this.#source;
    if (source === undefined) {
      throw new MissingComponentError("Process has no file. Call loadFile(...) before splitting.");
    }
    const signal = options.signal ?? new AbortController().signal;
    const logger = options.logger ?? this.#logger;
    const { document, mimeType } = await this.#read(source, signal, logger, options);
    await this.#cut(document, mimeType, signal, logger, options);
    const report = this.#lastSplit;
    if (report === undefined) throw new SplitFailedError("no split was planned");
    return report;
  }

  /** Release the splitter and the default extractor. Idempotent per component. */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([
      this.#splitter?.dispose?.(),
      this.#extractor?.dispose(),
      ...this.#loaders.map((loader) => loader.dispose?.()),
    ]);
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} component(s) failed to dispose.`);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  async #read(
    source: DocumentSource,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<{ document: LoadedDocument; mimeType: string }> {
    if (isLoadedSource(source)) {
      return {
        document: source.loaded,
        mimeType: source.mimeType ?? "application/octet-stream",
      };
    }

    const loaders = this.#loaders.length > 0 ? this.#loaders : this.#extractor?.components.loaders;
    if (loaders === undefined || loaders.length === 0) {
      throw new MissingComponentError(
        "Process has no loader. Call loadDocumentLoader(...), or loadExtractor(...) with one wired.",
      );
    }

    const raw = await resolveSource(source, signal);
    const read = await loadDocument(loaders, raw, logger, signal, options.stageTimeoutMs);
    return { document: read.document, mimeType: raw.mimeType ?? "application/octet-stream" };
  }

  /**
   * What to call a bundle that turned out to be one page.
   *
   * With one candidate there is nothing to decide. With several, the question is a
   * classification rather than a split, so it is answered by the machinery that
   * already exists for it — and the pages are handed over already read.
   */
  async #nameSinglePage(
    document: LoadedDocument,
    mimeType: string,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<string> {
    const only = this.#classifications[0];
    if (only !== undefined && this.#classifications.length === 1) return only.name;

    const extractor = this.#extractor;
    if (extractor === undefined || extractor.components.classifiers.length === 0) {
      return UNCLASSIFIED;
    }

    const verdict = await extractor.classify({ loaded: document, mimeType }, this.#classifications, {
      ...options,
      signal,
      logger,
    });
    return verdict.name;
  }

  async #cut(
    document: LoadedDocument,
    mimeType: string,
    signal: AbortSignal,
    logger: Logger,
    options: RunOptions,
  ): Promise<DocGroups> {
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
          classification: await this.#nameSinglePage(document, mimeType, signal, logger, options),
        },
      ];
      this.#lastSplit = {
        splitter: "none",
        strategy: this.#strategy,
        groups,
        usage: EMPTY_USAGE,
      };
      return groups;
    }

    const splitter = this.#splitter;
    if (splitter === undefined) {
      throw new SplitFailedError("no splitter is loaded. Call loadSplitter(...) before split()");
    }

    // A splitter that needs page images must not be handed a text-only document and
    // discover it forty pages in. Features come from what the pages actually carry,
    // which is the stricter reading than whatever the loader claims it can do.
    const features = preloadedFeatures({ loaded: document, mimeType });
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
      recordUsage: (part) => {
        usage = sumUsage([usage, part], usage.wallMs);
      },
    };

    const groups = await runSplitter(splitter, document.pages, this.#strategy, ctx);
    this.#lastSplit = {
      splitter: splitter.name,
      strategy: this.#strategy,
      groups,
      usage: { ...usage, wallMs: Date.now() - started },
    };
    logger.info("split", { splitter: splitter.name, groups: String(groups.length) });
    return groups;
  }
}
