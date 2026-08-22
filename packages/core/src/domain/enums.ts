/**
 * The closed vocabularies, as enums you can reach for by name.
 *
 * Each is a frozen object PLUS a type of the same name, so `CompletionStrategy.PAGINATE`
 * reads like Python's `CompletionStrategy.PAGINATE` while the value stays the literal
 * string `"paginate"`. That matters both ways round:
 *
 *   - `completion: CompletionStrategy.PAGINATE` — discoverable, autocompletes, no typos.
 *   - `completion: "paginate"` — still valid, because the type IS the string union.
 *
 * A TypeScript `enum` would have bought the first and lost the second, and would not
 * survive `isolatedModules` in a `.d.ts` consumer without a runtime import.
 */

/** How a document too large for one request is turned into one answer. */
export const CompletionStrategy = {
  /** One request. If the document does not fit, that is an error, not a silent split. */
  FORBIDDEN: "forbidden",
  /** One request per page; merge the partials. */
  PAGINATE: "paginate",
  /** Chunk to the token budget; merge the partials. */
  CONCATENATE: "concatenate",
} as const;
export type CompletionStrategy = (typeof CompletionStrategy)[keyof typeof CompletionStrategy];

/** How a bundle of several documents is cut into individual ones. */
export const SplittingStrategy = {
  /** Ask about the whole document at once. Fewer calls, needs it all to fit. */
  EAGER: "eager",
  /** Walk page pairs and ask "same document?". Scales to long bundles. */
  LAZY: "lazy",
} as const;
export type SplittingStrategy = (typeof SplittingStrategy)[keyof typeof SplittingStrategy];

/** How several classifiers' disagreeing verdicts are reduced to one. */
export const ClassificationStrategy = {
  /** Most-voted name wins; ties broken by summed confidence. */
  CONSENSUS: "consensus",
  /** The single most confident verdict wins, however alone it is. */
  HIGHER_ORDER: "higherOrder",
  /** Consensus, and every voter must also clear `threshold`. */
  CONSENSUS_WITH_THRESHOLD: "consensusWithThreshold",
} as const;
export type ClassificationStrategy =
  (typeof ClassificationStrategy)[keyof typeof ClassificationStrategy];
