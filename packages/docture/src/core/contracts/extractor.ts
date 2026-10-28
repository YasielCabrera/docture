/**
 * What a {@link Classification} needs from the thing that will extract it.
 *
 * Declared as a contract here, above the `Extractor` class that implements it, for
 * one reason: a classification may carry its OWN extractor — a cheaper model for
 * receipts, a vision pipeline for licences — and `Classification` must be able to
 * say so without `contracts/` depending on the composition root.
 */

import type { DocumentSource } from "../domain/document.js";
import type { ExtractionResult } from "../domain/result.js";
import type { ContractLike, InferContract } from "../domain/contract.js";
import type { RunOptions } from "../pipeline/run.js";

/** The extraction surface. `Extractor` implements it; a test double can too. */
export interface DocumentExtractor {
  /** The full envelope: data, which strategy answered, every attempt, cost. */
  extractResult<C extends ContractLike>(
    source: DocumentSource,
    contract: C,
    options?: RunOptions<InferContract<C>>,
  ): Promise<ExtractionResult<InferContract<C>>>;
}
