/**
 * `Extractor` — the composition root, and the class you reach for first.
 *
 * Two ways to build one, because they suit different moments:
 *
 * ```ts
 * // Fluent. Reads top-to-bottom, and each line is one decision.
 * const extractor = new Extractor()
 *   .loadDocumentLoader(new DocumentLoaderPdfJs())
 *   .loadLlm(new LLM(openai("gpt-5")));
 *
 * // Declarative. One object, so it can come from a config file.
 * const extractor = new Extractor({
 *   loaders: [new DocumentLoaderPdfJs()],
 *   strategies: [llm({ model: openai("gpt-5") })],
 * });
 * ```
 *
 * There is no `model` option: a model belongs to the strategy that calls it, so core
 * never imports the AI SDK and a deterministic-only pipeline pulls no model code at
 * all. `loadLlm` takes a {@link ModelBackend} — `@docture/llm`'s `LLM` — which is the
 * seam that keeps that true.
 */

import type { FlexibleSchema } from "@ai-sdk/provider-utils";
import {
  isContract,
  schemaOf,
  type ContractLike,
  type InferContract,
} from "./domain/contract.js";
import { isLoadedSource, type DocumentSource } from "./domain/document.js";
import type { Logger } from "./domain/logger.js";
import type { ExtractionResult } from "./domain/result.js";
import {
  flattenTree,
  isClassificationTree,
  type Classification,
  type ClassificationNames,
  type ClassificationNode,
  type ClassificationResponse,
  type ClassificationTree,
  type Classifier,
} from "./contracts/classifier.js";
import type { DocumentExtractor } from "./contracts/extractor.js";
import type { DocumentLoader } from "./contracts/loader.js";
import type { LoadLlmOptions, ModelBackend } from "./contracts/model.js";
import type { ExtractionStrategy } from "./contracts/strategy.js";
import { classifyDocument, type ClassifyOptions } from "./pipeline/classify.js";
import { declarationOrder, eligibleLoaders, type RoutingPolicy } from "./pipeline/eligibility.js";
import { DuplicateComponentError, NoEligibleLoaderError } from "./pipeline/errors.js";
import { documentFeatures, preloadedFeatures } from "./pipeline/features.js";
import { runPipeline, type RunOptions } from "./pipeline/run.js";
import { resolveSource } from "./pipeline/source.js";
import { silentLogger } from "./domain/logger.js";

export interface ExtractorOptions {
  /** Tried in order; the first that accepts the media type and does not throw wins. */
  readonly loaders?: readonly DocumentLoader[];
  /** Tried in order. Order IS the default routing policy. */
  readonly strategies?: readonly ExtractionStrategy[];
  readonly classifiers?: readonly Classifier[];
  /** Default candidate document kinds. Overridable per call. */
  readonly classifications?: readonly Classification[];
  /** Reorder eligible strategies. Sees only feasible candidates. */
  readonly policy?: RoutingPolicy;
  readonly logger?: Logger;
  /** Per-stage deadline in ms. Omit for none. */
  readonly stageTimeoutMs?: number;
  /** How to reconcile disagreeing classifiers. Default: most-confident wins. */
  readonly classify?: ClassifyOptions;
}

export type SafeExtraction<T> =
  | { readonly ok: true; readonly result: ExtractionResult<T> }
  | { readonly ok: false; readonly error: Error };

export interface BatchOptions extends RunOptions {
  /** How many documents to process at once. Default 4. */
  readonly concurrency?: number;
}

export interface BatchItem<T> {
  readonly source: DocumentSource;
  readonly index: number;
  readonly outcome: SafeExtraction<T>;
}

export class Extractor implements DocumentExtractor {
  #loaders: DocumentLoader[];
  #strategies: ExtractionStrategy[];
  #classifiers: Classifier[];
  #classifications: Classification[];
  #policy: RoutingPolicy;
  #logger: Logger;
  #stageTimeoutMs: number | undefined;
  #classify: ClassifyOptions | undefined;
  #disposed: Promise<void> | undefined;

  constructor(options: ExtractorOptions = {}) {
    this.#loaders = [...(options.loaders ?? [])];
    this.#strategies = [...(options.strategies ?? [])];
    this.#classifiers = [...(options.classifiers ?? [])];
    this.#classifications = [...(options.classifications ?? [])];
    this.#policy = options.policy ?? declarationOrder;
    this.#logger = options.logger ?? silentLogger;
    this.#stageTimeoutMs = options.stageTimeoutMs;
    this.#classify = options.classify;

    // Two components under one name would silently shadow. Fail at wiring time.
    assertUnique("loader", this.#loaders);
    assertUnique("strategy", this.#strategies);
    assertUnique("classifier", this.#classifiers);
    assertUnique("classification", this.#classifications);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────────

  /** Register a loader. Called more than once, order is the fallback order. */
  loadDocumentLoader(...loaders: readonly DocumentLoader[]): this {
    for (const loader of loaders) {
      assertNew("loader", this.#loaders, loader);
      this.#loaders.push(loader);
    }
    return this;
  }

  /** Register a strategy. Order IS the routing order. */
  loadStrategy(...strategies: readonly ExtractionStrategy[]): this {
    for (const strategy of strategies) {
      assertNew("strategy", this.#strategies, strategy);
      this.#strategies.push(strategy);
    }
    return this;
  }

  /**
   * Register a model, as the strategies it implies.
   *
   * The model arrives as a {@link ModelBackend} — `new LLM(openai("gpt-5"))` — which
   * is what lets core accept a model without depending on one.
   */
  loadLlm(backend: ModelBackend, options: LoadLlmOptions = {}): this {
    this.loadStrategy(backend.extraction());

    if (options.vision === true) {
      if (backend.vision === undefined) {
        throw new TypeError(
          `Model "${backend.id}" has no vision strategy, so { vision: true } cannot be honoured.`,
        );
      }
      this.loadStrategy(backend.vision());
    }

    if (options.classify === true) {
      if (backend.classifier === undefined) {
        throw new TypeError(
          `Model "${backend.id}" has no classifier, so { classify: true } cannot be honoured.`,
        );
      }
      this.loadClassifier(backend.classifier());
    }

    return this;
  }

  loadClassifier(...classifiers: readonly Classifier[]): this {
    for (const classifier of classifiers) {
      assertNew("classifier", this.#classifiers, classifier);
      this.#classifiers.push(classifier);
    }
    return this;
  }

  /** Set the default candidate document kinds. Any call may override them. */
  loadClassifications(...classifications: readonly Classification[]): this {
    for (const classification of classifications) {
      assertNew("classification", this.#classifications, classification);
      this.#classifications.push(classification);
    }
    return this;
  }

  /** Reorder eligible strategies. The policy only ever sees feasible candidates. */
  loadPolicy(policy: RoutingPolicy): this {
    this.#policy = policy;
    return this;
  }

  loadLogger(logger: Logger): this {
    this.#logger = logger;
    return this;
  }

  /** What is wired, for an `inspect` command or a test. */
  get components(): {
    readonly loaders: readonly DocumentLoader[];
    readonly strategies: readonly ExtractionStrategy[];
    readonly classifiers: readonly Classifier[];
    readonly classifications: readonly Classification[];
  } {
    return {
      loaders: [...this.#loaders],
      strategies: [...this.#strategies],
      classifiers: [...this.#classifiers],
      classifications: [...this.#classifications],
    };
  }

  // ── Extraction ────────────────────────────────────────────────────────────────

  /**
   * Extract `contract` from `source`.
   *
   * The return type is inferred from the contract, so `result.data` is typed to its
   * leaves whether you passed a `Contract`, Zod, Valibot, ArkType or raw JSON
   * Schema.
   *
   * @throws {@link DoctureError} — see {@link Extractor.safeExtract} for the
   * non-throwing form.
   */
  async extract<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions,
  ): Promise<ExtractionResult<InferContract<C>>> {
    return runPipeline(
      this.#components(),
      source,
      schemaOf(contract) as FlexibleSchema<InferContract<C>>,
      this.#runOptions(contract, options),
    );
  }

  /** {@link Extractor.extract}, spelled out. Same call, clearer at a use site. */
  extractResult<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions,
  ): Promise<ExtractionResult<InferContract<C>>> {
    return this.extract(source, contract, options);
  }

  /**
   * Just the data.
   *
   * `extract` returns the envelope — which strategy answered, every attempt and its
   * error, the token cost — because those are the questions asked when a number
   * looks wrong. When you only want the fields, this is the one-liner:
   *
   * ```ts
   * const invoice = await extractor.extractData("invoice.pdf", Invoice);
   * invoice.total;   // number
   * ```
   */
  async extractData<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions,
  ): Promise<InferContract<C>> {
    const result = await this.extract(source, contract, options);
    return result.data;
  }

  /** `extract` without the throw. Mirrors Zod's `parse` / `safeParse` pairing. */
  async safeExtract<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions,
  ): Promise<SafeExtraction<InferContract<C>>> {
    try {
      return { ok: true, result: await this.extract(source, contract, options) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Extract many documents, yielding each as it finishes. Never rejects — a failed
   * document arrives as an `ok: false` item, so one bad scan in a batch of 500 does
   * not lose the other 499.
   */
  async *extractBatch<C extends ContractLike>(
    sources: readonly DocumentSource[],
    contract: C,
    options?: BatchOptions,
  ): AsyncGenerator<BatchItem<InferContract<C>>, void, undefined> {
    const limit = Math.max(1, options?.concurrency ?? 4);
    let next = 0;
    const inFlight = new Map<number, Promise<BatchItem<InferContract<C>>>>();

    const start = (index: number): void => {
      const source = sources[index];
      if (source === undefined) return;
      inFlight.set(
        index,
        this.safeExtract(source, contract, options).then((outcome) => ({ source, index, outcome })),
      );
    };

    while (next < sources.length && inFlight.size < limit) start(next++);

    while (inFlight.size > 0) {
      const item = await Promise.race(inFlight.values());
      inFlight.delete(item.index);
      yield item;
      if (next < sources.length) start(next++);
    }
  }

  // ── Classification ────────────────────────────────────────────────────────────

  /**
   * Decide what kind of document this is, without extracting it.
   *
   * `name` comes back as a literal union of the candidates you passed, so a `switch`
   * over it is exhaustive and `classification` narrows with it.
   */
  async classify<const C extends readonly Classification[]>(
    source: DocumentSource,
    classifications?: C,
    options?: RunOptions,
  ): Promise<ClassificationResponse<C>> {
    const candidates = (classifications ?? this.#classifications) as unknown as C;
    const verdict = await this.#classifyAgainst(source, candidates, options);
    return verdict;
  }

  /**
   * Descend a {@link ClassificationTree} one level at a time.
   *
   * The point is prompt size: choosing between four families and then between the
   * winner's four members is two cheap questions, where choosing between sixteen
   * kinds is one expensive and less accurate one. The returned `path` is every
   * verdict on the way down, root first.
   */
  async classifyTree(
    source: DocumentSource,
    tree: ClassificationTree,
    options?: RunOptions,
  ): Promise<{
    readonly leaf: ClassificationResponse;
    readonly path: readonly ClassificationResponse[];
  }> {
    const path: ClassificationResponse[] = [];
    let nodes: readonly ClassificationNode[] = tree.nodes;
    let leaf: ClassificationResponse = { name: "UNKNOWN", confidence: 0, signals: [] };

    while (nodes.length > 0) {
      const candidates = nodes.map((node) => node.classification);
      const verdict = await this.#classifyAgainst(source, candidates, options);
      path.push(verdict);
      leaf = verdict;
      if (verdict.classification === undefined) break;
      const chosen = nodes.find((node) => node.classification.name === verdict.name);
      nodes = chosen?.children ?? [];
    }

    return { leaf, path };
  }

  /** Every classification in a tree, depth-first — for a report or a validation. */
  static flatten(tree: ClassificationTree): Classification[] {
    return flattenTree(tree);
  }

  // ── Teardown ──────────────────────────────────────────────────────────────────

  /** Release every component. Idempotent. */
  dispose(): Promise<void> {
    // Collect once, settle all, surface every failure: one engine's broken teardown
    // must not hide another's.
    this.#disposed ??= (async () => {
      const disposables = [...this.#loaders, ...this.#strategies, ...this.#classifiers].filter(
        (c): c is typeof c & { dispose(): Promise<void> } => typeof c.dispose === "function",
      );
      const results = await Promise.allSettled(disposables.map((c) => c.dispose()));
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} component(s) failed to dispose.`);
      }
    })();
    return this.#disposed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  #components() {
    if (this.#loaders.length === 0) {
      throw new TypeError(
        "This Extractor has no loader. Call loadDocumentLoader(...) before extracting.",
      );
    }
    return {
      loaders: this.#loaders,
      strategies: this.#strategies,
      classifiers: this.#classifiers,
      classifications: this.#classifications,
      policy: this.#policy,
      logger: this.#logger,
      ...(this.#stageTimeoutMs === undefined ? {} : { stageTimeoutMs: this.#stageTimeoutMs }),
      ...(this.#classify === undefined ? {} : { classify: this.#classify }),
    };
  }

  /**
   * A `Contract`'s own name and description are prompt material, so they are folded
   * into the run as a single-candidate classification when the caller named none.
   * Extracting `contract({ name: "invoice", description: "…" })` should not need the
   * word "invoice" repeated in an options bag.
   */
  #runOptions(contract: ContractLike, options: RunOptions | undefined): RunOptions {
    if (!isContract(contract) || options?.classifications !== undefined) {
      return options ?? {};
    }
    if (this.#classifications.length > 0) return options ?? {};
    return {
      ...options,
      classifications: [
        {
          name: contract.name,
          description: contract.description ?? contract.name,
          schema: contract.schema,
          ...(contract.hints === undefined ? {} : { hints: contract.hints }),
        },
      ],
    };
  }

  async #classifyAgainst<const C extends readonly Classification[]>(
    source: DocumentSource,
    candidates: C,
    options: RunOptions | undefined,
  ): Promise<ClassificationResponse<C>> {
    const signal = options?.signal ?? new AbortController().signal;
    const logger = options?.logger ?? this.#logger;

    let document;
    let features;

    if (isLoadedSource(source)) {
      document = source.loaded;
      features = preloadedFeatures(source);
    } else {
      const raw = await resolveSource(source, signal);
      const mimeType = raw.mimeType ?? "application/octet-stream";
      const { eligible, gaps } = eligibleLoaders(this.#loaders, mimeType);
      const loader = eligible[0];
      if (loader === undefined) throw new NoEligibleLoaderError(mimeType, gaps);
      document = await loader.load(raw, { signal, logger });
      features = documentFeatures(document, loader, mimeType);
    }

    const result = await classifyDocument(
      this.#classifiers,
      candidates,
      document,
      features,
      logger,
      signal,
      options?.stageTimeoutMs ?? this.#stageTimeoutMs,
      options?.classify ?? this.#classify ?? {},
    );

    const matched = candidates.find((candidate) => candidate.name === result.name);
    return {
      name: result.name as ClassificationNames<C> | "UNKNOWN",
      confidence: result.confidence,
      signals: result.signals,
      ...(matched === undefined ? {} : { classification: matched }),
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

function assertNew(
  kind: string,
  existing: readonly { readonly name: string }[],
  candidate: { readonly name: string },
): void {
  if (existing.some((item) => item.name === candidate.name)) {
    throw new DuplicateComponentError(kind, candidate.name);
  }
}

/**
 * Build an `Extractor` from one options object.
 *
 * Equivalent to `new Extractor(options)`, and kept because a config file, a CLI and
 * a factory all want to pass a plain object rather than chain calls. The one
 * difference: this insists on at least one loader up front, since an options object
 * is the whole wiring and an empty `loaders` is a mistake rather than a stage.
 */
export function createExtractor(options: ExtractorOptions): Extractor {
  if ((options.loaders ?? []).length === 0) {
    throw new TypeError("createExtractor needs at least one loader.");
  }
  return new Extractor(options);
}
