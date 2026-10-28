import type { FlexibleSchema } from "@ai-sdk/provider-utils";
import {
  isContract,
  schemaOf,
  type ContractLike,
  type InferContract,
} from "./domain/contract.js";
import { isLoadedSource, type DocumentSource } from "./domain/document.js";
import type { Logger } from "./domain/logger.js";
import type { ExtractionResult, RuleFailureMode, ValidationRule } from "./domain/result.js";
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
import { createDisposalScope, type DisposalScope } from "./contracts/disposal.js";
import { batchConcurrency } from "./pipeline/batch.js";
import type { DocumentLoader } from "./contracts/loader.js";
import type { LoadLlmOptions, ModelBackend } from "./contracts/model.js";
import type { ExtractionStrategy } from "./contracts/strategy.js";
import { classifyDocument, type ClassifyOptions } from "./pipeline/classify.js";
import { declarationOrder, type RoutingPolicy } from "./pipeline/eligibility.js";
import { DuplicateComponentError, MissingComponentError } from "./pipeline/errors.js";
import { readDocument } from "./pipeline/read.js";
import { documentFeatures, preloadedFeatures } from "./pipeline/features.js";
import { checkedMaxRepairs, checkedRuleFailureMode, runPipeline, snapshotRunOptions, withContractGuidance, type RunOptions } from "./pipeline/run.js";
import { resolveSource, type SourceResolver } from "./pipeline/source.js";
import { silentLogger } from "./domain/logger.js";

export interface ExtractorOptions {
  /** Local file access is explicit through docture/node or a caller-supplied resolver. */
  readonly sourceResolver?: SourceResolver;
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
  /**
   * Default rules for every call. They receive `unknown` because one extractor serves
   * many contracts. A call's own `rules`, even `[]`, replaces them.
   */
  readonly rules?: readonly ValidationRule[];
  /** Default `"report"`. */
  readonly onRuleFailure?: RuleFailureMode;
  /** Default repairs per strategy. Default 1; 0 disables repair. A call may override it. */
  readonly maxRepairs?: number;
}

export type SafeExtraction<T> =
  | { readonly ok: true; readonly result: ExtractionResult<T> }
  | { readonly ok: false; readonly error: Error };

export interface BatchOptions<T = unknown> extends RunOptions<T> {
  /** How many documents to process at once. Default 4. */
  readonly concurrency?: number;
}

export interface BatchItem<T> {
  readonly source: DocumentSource;
  readonly index: number;
  readonly outcome: SafeExtraction<T>;
}

/**
 * Compose ordered loaders, classifiers and extraction strategies.
 *
 * @remarks ExtractorOptions configures loaders, strategies, classifications, logging and stage deadlines. Use dispose or await using to release owned components.
 * @throws MISSING_COMPONENT for missing wiring; DUPLICATE_COMPONENT for reused names; extraction methods also report load, eligibility and contract error codes.
 * @example
 * ```ts
 * import { Extractor, DocumentLoaderData } from "docture";
 * const extractor = new Extractor({ loaders: [new DocumentLoaderData()] });
 * ```
 */
export class Extractor implements DocumentExtractor {
  #loaders: DocumentLoader[];
  #sourceResolver: SourceResolver;
  #strategies: ExtractionStrategy[];
  #classifiers: Classifier[];
  #classifications: Classification[];
  #policy: RoutingPolicy;
  #logger: Logger;
  #stageTimeoutMs: number | undefined;
  #classify: ClassifyOptions | undefined;
  #rules: readonly ValidationRule[] | undefined;
  #onRuleFailure: RuleFailureMode | undefined;
  #maxRepairs: number | undefined;
  #disposed: Promise<void> | undefined;

  constructor(options: ExtractorOptions = {}) {
    this.#sourceResolver = options.sourceResolver ?? resolveSource;
    this.#loaders = [...(options.loaders ?? [])];
    this.#strategies = [...(options.strategies ?? [])];
    this.#classifiers = [...(options.classifiers ?? [])];
    this.#classifications = [...(options.classifications ?? [])];
    this.#policy = options.policy ?? declarationOrder;
    this.#logger = options.logger ?? silentLogger;
    this.#stageTimeoutMs = options.stageTimeoutMs;
    this.#classify = options.classify;
    this.#rules = options.rules === undefined ? undefined : [...options.rules];
    this.#onRuleFailure = options.onRuleFailure === undefined ? undefined : checkedRuleFailureMode(options.onRuleFailure);
    this.#maxRepairs = options.maxRepairs === undefined ? undefined : checkedMaxRepairs(options.maxRepairs);

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
        throw new MissingComponentError(
          `Model "${backend.id}" has no vision strategy, so { vision: true } cannot be honoured.`,
        );
      }
      this.loadStrategy(backend.vision());
    }

    if (options.classify === true) {
      if (backend.classifier === undefined) {
        throw new MissingComponentError(
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
    options?: RunOptions<InferContract<C>>,
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
    options?: RunOptions<InferContract<C>>,
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
    options?: RunOptions<InferContract<C>>,
  ): Promise<InferContract<C>> {
    const result = await this.extract(source, contract, options);
    return result.data;
  }

  /** `extract` without the throw. Mirrors Zod's `parse` / `safeParse` pairing. */
  async safeExtract<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions<InferContract<C>>,
  ): Promise<SafeExtraction<InferContract<C>>> {
    try {
      return { ok: true, result: await this.extract(source, contract, options) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Extract many documents, yielding each as it finishes. A failed document arrives
   * as an `ok: false` item; invalid batch options reject before processing starts.
   * Early exit aborts and awaits in-flight jobs. A job that ignores cancellation
   * delays the return until it settles.
   */
  async *extractBatch<C extends ContractLike>(
    sources: readonly DocumentSource[],
    contract: C,
    options?: BatchOptions<InferContract<C>>,
  ): AsyncGenerator<BatchItem<InferContract<C>>, void, undefined> {
    const limit = batchConcurrency(options?.concurrency);
    const controller = new AbortController();
    const snapshot = snapshotRunOptions(options ?? {});
    const callerSignal = snapshot.signal;
    const signal = callerSignal === undefined
      ? controller.signal
      : AbortSignal.any([callerSignal, controller.signal]);
    const jobOptions = { ...snapshot, signal };
    let next = 0;
    const inFlight = new Map<number, Promise<BatchItem<InferContract<C>>>>();

    const start = (index: number): void => {
      const source = sources[index];
      if (source === undefined) return;
      inFlight.set(
        index,
        this.safeExtract(source, contract, jobOptions).then((outcome) => ({ source, index, outcome })),
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
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  dispose(scope: DisposalScope = createDisposalScope()): Promise<void> {
    this.#disposed ??= scope.dispose(...this.#loaders, ...this.#strategies, ...this.#classifiers);
    return this.#disposed;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  #components() {
    if (this.#loaders.length === 0) {
      throw new MissingComponentError(
        "This Extractor has no loader. Call loadDocumentLoader(...) before extracting.",
      );
    }
    return {
      loaders: this.#loaders,
      sourceResolver: this.#sourceResolver,
      strategies: this.#strategies,
      classifiers: this.#classifiers,
      classifications: this.#classifications,
      policy: this.#policy,
      logger: this.#logger,
      ...(this.#stageTimeoutMs === undefined ? {} : { stageTimeoutMs: this.#stageTimeoutMs }),
      ...(this.#classify === undefined ? {} : { classify: this.#classify }),
      ...(this.#rules === undefined ? {} : { rules: this.#rules }),
      ...(this.#onRuleFailure === undefined ? {} : { onRuleFailure: this.#onRuleFailure }),
      ...(this.#maxRepairs === undefined ? {} : { maxRepairs: this.#maxRepairs }),
    };
  }

  /**
   * A `Contract`'s own name and description are prompt material, so they are folded
   * into the run as a single-candidate classification when the caller named none.
   * Extracting `contract({ name: "invoice", description: "…" })` should not need the
   * word "invoice" repeated in an options bag.
   */
  #runOptions<T>(contract: ContractLike, options: RunOptions<T> | undefined): RunOptions<T> {
    if (!isContract(contract)) return options ?? {};
    const guided = withContractGuidance(options ?? {}, contract);
    if (guided.classifications !== undefined || this.#classifications.length > 0) return guided;
    return {
      ...guided,
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
    let documentLabel: string | undefined;

    if (isLoadedSource(source)) {
      document = source.loaded;
      features = preloadedFeatures(source);
      documentLabel = source.fileName;
    } else {
      const raw = await this.#sourceResolver(source, signal);
      const mimeType = raw.mimeType ?? "application/octet-stream";
      const loaded = await readDocument(
        this.#loaders, raw, logger, signal, options?.stageTimeoutMs ?? this.#stageTimeoutMs,
      );
      document = loaded.document;
      features = documentFeatures(document, loaded.loader, mimeType);
      documentLabel = raw.fileName;
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
      documentLabel,
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
    throw new MissingComponentError("createExtractor needs at least one loader.");
  }
  return new Extractor(options);
}
