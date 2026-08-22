/**
 * Classification: deciding what kind of document this is, so the right schema and
 * the right parser get used.
 *
 * The payoff is type-level. A classification carries its OWN schema, so extracting
 * a mixed bundle returns a discriminated union and narrowing on `name` narrows
 * `data` — see {@link ClassifiedExtraction}.
 */

import type { FlexibleSchema, InferSchema } from "@ai-sdk/provider-utils";
import type { Contract, ContractLike, InferContract } from "../domain/contract.js";
import type { DocumentFact, DocumentFeatures } from "../domain/document.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import type { ClassificationSignal, ExtractionResult } from "../domain/result.js";
import type { DocumentExtractor } from "./extractor.js";

/** One document kind: what it is called, how to recognise it, what shape it has. */
export interface Classification<
  Name extends string = string,
  S extends FlexibleSchema = FlexibleSchema,
  E extends ContractLike = S,
> {
  /** Discriminant. Keep it a literal — `defineClassification` pins it for you. */
  readonly name: Name;
  /** Prose a model (or a human) can use to recognise this kind. */
  readonly description: string;
  /** The output contract for THIS kind. */
  readonly schema: S;
  /** Extra prompt guidance: layout quirks, unit conventions, gotchas. */
  readonly hints?: string;
  /**
   * Extract this kind with THIS extractor instead of the one that classified.
   *
   * The point is per-kind economics: a receipt is three fields and deserves a cheap
   * model, a 40-page contract is not. Absent, the extractor that owns the run does
   * the extraction too.
   */
  readonly extractor?: DocumentExtractor;
  /**
   * Extract against a DIFFERENT contract than the one used to recognise the kind.
   *
   * Recognising an invoice needs two fields; extracting one needs forty. Splitting
   * them keeps the classification prompt cheap without narrowing the payload.
   */
  readonly extractionContract?: E;
  /** A reference image of this kind, for a vision classifier. Path or bytes. */
  readonly image?: string | Uint8Array;
}

/**
 * Identity helper that pins `name` to a literal type. Without the `const` type
 * parameter, `name: "invoice"` widens to `string` and the narrowing below is lost.
 */
export function defineClassification<
  const Name extends string,
  S extends FlexibleSchema,
  E extends ContractLike = S,
>(classification: Classification<Name, S, E>): Classification<Name, S, E> {
  return classification;
}

/**
 * A classification built from a {@link Contract}, so the name and the description
 * are not restated.
 *
 * ```ts
 * const Invoice = contract({ name: "invoice", description: "…", schema: … });
 * const invoice = classificationOf(Invoice);           // name: "invoice"
 * ```
 */
export function classificationOf<S extends FlexibleSchema>(
  source: Contract<InferSchema<S>> & { readonly schema: S },
  overrides?: Omit<Partial<Classification<string, S, S>>, "schema">,
): Classification<string, S, S> {
  return {
    name: source.name,
    description: source.description ?? source.name,
    schema: source.schema,
    ...(source.hints === undefined ? {} : { hints: source.hints }),
    ...overrides,
  };
}

/** The schema a classification extracts against — `extractionContract` wins. */
export function extractionContractOf(classification: Classification): ContractLike {
  return classification.extractionContract ?? classification.schema;
}

/**
 * The discriminated union produced by extracting against a list of
 * classifications.
 *
 * ```ts
 * for (const r of await process.split([invoice, receipt]).extract()) {
 *   if (r.name === "invoice") r.data.invoiceNumber;  // narrowed to the invoice schema
 *   else                      r.data.merchantName;   // narrowed to the receipt schema
 * }
 * ```
 */
export type ClassifiedExtraction<C extends readonly Classification[]> = {
  [K in keyof C]: C[K] extends Classification<infer Name, infer S, infer E>
    ? {
        readonly name: Name;
        /** Typed from `extractionContract` when there is one, else from `schema`. */
        readonly data: InferContract<E>;
        readonly result: ExtractionResult<InferContract<E>>;
        /** Which pages of the bundle this document occupied, 1-based. */
        readonly pages: readonly number[];
      }
    : never;
}[number];

/** Names in a classification list, as a literal union. */
export type ClassificationNames<C extends readonly Classification[]> = C[number]["name"];

export interface ClassifyContext {
  readonly document: LoadedDocument;
  readonly features: DocumentFeatures;
  readonly candidates: readonly Classification[];
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

export interface Classifier {
  readonly name: string;
  readonly requires?: readonly DocumentFact[];
  /**
   * Return a verdict, or `null` to abstain.
   *
   * A classifier must NEVER throw — a broken classifier should not fail a
   * document that a later one, or the fallback, could have handled. Swallow and
   * report via the returned signal's `note`.
   */
  classify(ctx: ClassifyContext): Promise<ClassificationSignal | null>;
  dispose?(): Promise<void>;
}

/** Identity helper, for symmetry with `defineLoader`. */
export function defineClassifier(classifier: Classifier): Classifier {
  return classifier;
}

/**
 * A classification verdict, with the candidate it matched attached.
 *
 * `name` is a literal union of the candidates you passed, so a `switch` over it is
 * exhaustive and `classification` narrows with it. `signals` is what the plain
 * {@link ClassificationResult} carries — every classifier's opinion, including the
 * abstentions — because "the invoice classifier abstained and the fallback guessed"
 * is a different answer to "three classifiers agreed".
 */
export interface ClassificationResponse<
  C extends readonly Classification[] = readonly Classification[],
> {
  readonly name: ClassificationNames<C> | "UNKNOWN";
  /** 0–1. */
  readonly confidence: number;
  /** Every classifier's verdict, including abstentions. */
  readonly signals: readonly ClassificationSignal[];
  /** The candidate `name` refers to. Absent exactly when `name` is `"UNKNOWN"`. */
  readonly classification?: C[number];
}

/**
 * One node of a classification hierarchy.
 *
 * Trees exist to keep a prompt short. Asking one model to choose between forty
 * document kinds is both expensive and bad; asking it to choose between four
 * families and then between the four members of the winner is neither.
 */
export interface ClassificationNode<C extends Classification = Classification> {
  readonly classification: C;
  readonly children?: readonly ClassificationNode[];
}

/** A classification hierarchy. Descend it one level at a time. */
export interface ClassificationTree {
  readonly nodes: readonly ClassificationNode[];
}

/** Identity helper that pins the node's classification type. */
export function classificationNode<const C extends Classification>(
  classification: C,
  children?: readonly ClassificationNode[],
): ClassificationNode<C> {
  return { classification, ...(children === undefined ? {} : { children }) };
}

/** Identity helper, for symmetry with the rest. */
export function classificationTree(nodes: readonly ClassificationNode[]): ClassificationTree {
  return { nodes };
}

/** True when `value` is a {@link ClassificationTree} rather than a flat list. */
export function isClassificationTree(
  value: readonly Classification[] | ClassificationTree,
): value is ClassificationTree {
  return !Array.isArray(value);
}

/** Every classification in a tree, depth-first. Useful for reports and validation. */
export function flattenTree(tree: ClassificationTree): Classification[] {
  const out: Classification[] = [];
  const walk = (nodes: readonly ClassificationNode[]): void => {
    for (const node of nodes) {
      out.push(node.classification);
      if (node.children !== undefined) walk(node.children);
    }
  };
  walk(tree.nodes);
  return out;
}
