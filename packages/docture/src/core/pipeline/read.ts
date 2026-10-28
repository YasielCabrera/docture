import { failedAttempt } from "./attempt.js";
/**
 * Reading a document — the load stage, on its own.
 *
 * Shared because three callers need it and must not disagree: the run loop,
 * `Extractor.classify`, and `Process`, which reads a bundle once and then extracts
 * each document it found out of the pages already in memory.
 */

import type { RawDocument } from "../domain/document.js";
import type { LoadedDocument } from "../domain/geometry.js";
import type { Logger } from "../domain/logger.js";
import type { Attempt } from "../domain/result.js";
import type { DocumentLoader, LoadRequest } from "../contracts/loader.js";
import { withDeadline } from "./deadline.js";
import { eligibleLoaders } from "./eligibility.js";
import {
  LoadFailedError,
  MissingEngineError,
  NoEligibleLoaderError,
  PageSelectionError,
  TimeoutError,
  errorCodeOf,
  isAbortError,
  messageOf,
} from "./errors.js";

export interface ReadDocument {
  readonly document: LoadedDocument;
  readonly loader: DocumentLoader;
  /** One entry per loader tried, in order. Only the failures matter downstream. */
  readonly attempts: readonly Attempt[];
}



/** Try each eligible loader in order; the first that does not throw wins. */
export async function readDocument(
  loaders: readonly DocumentLoader[],
  raw: RawDocument,
  logger: Logger,
  signal: AbortSignal,
  stageTimeoutMs: number | undefined,
  request?: LoadRequest,
): Promise<ReadDocument> {
  const mimeType = raw.mimeType ?? "application/octet-stream";
  const { eligible, gaps } = eligibleLoaders(loaders, mimeType);
  if (eligible.length === 0) throw new NoEligibleLoaderError(mimeType, gaps);

  const attempts: Attempt[] = [];
  const failures: unknown[] = [];

  for (const loader of eligible) {
    // Never begin work the caller has already cancelled. Checking here rather than
    // trusting each loader to notice makes abort semantics a property of the
    // pipeline instead of a property of however well-behaved a plugin happens to be.
    signal.throwIfAborted();
    const started = Date.now();
    const deadline = withDeadline(`load:${loader.name}`, stageTimeoutMs, signal);
    try {
      const document = await loader.load(raw, {
        signal: deadline.signal,
        logger: logger.child({ loader: loader.name }),
        ...(request === undefined ? {} : { request }),
      });
      deadline.signal.throwIfAborted();
      attempts.push({ stage: "load", strategy: loader.name, status: "ok", ms: Date.now() - started });
      return { document, loader, attempts };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof PageSelectionError) throw error;
      const failure = deadline.expired()
        ? new TimeoutError(`load:${loader.name}`, stageTimeoutMs ?? 0)
        : error;
      if (isAbortError(failure)) throw failure;
      logger.warn("loader failed", { loader: loader.name, errorCode: errorCodeOf(failure) });
      failures.push(failure);
      attempts.push(failedAttempt("load", loader.name, Date.now() - started, failure));
    } finally {
      deadline.release();
    }
  }

  const [first] = failures;
  if (first instanceof MissingEngineError && failures.every((failure) => failure instanceof MissingEngineError)) {
    throw first;
  }
  throw new LoadFailedError(attempts);
}
