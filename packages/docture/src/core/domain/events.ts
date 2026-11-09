import type { Logger } from "./logger.js";
import type { Attempt, ClassificationResult } from "./result.js";

export type PipelineEvent =
  /** A loader read the document. `ms` covers the whole load stage, including loaders that failed first. */
  | { readonly type: "load"; readonly loader: string; readonly pages: number; readonly ms: number }
  /** Extraction and classification: the classifiers reached this verdict. */
  | { readonly type: "classify"; readonly result: ClassificationResult }
  /** A finished attempt, the same object the call's `attempts` list holds. */
  | { readonly type: "attempt"; readonly attempt: Attempt }
  /** Conversion: layout analysis finished page `pageNumber`, the `done`th of `total`. */
  | { readonly type: "page"; readonly pageNumber: number; readonly done: number; readonly total: number };

/**
 * Receives each {@link PipelineEvent}. Keep it cheap: the pipeline waits for it to return.
 * The pipeline does not await a returned promise; a rejection is logged like a throw.
 */
export type PipelineEventListener = (event: PipelineEvent) => void;

export function isolatedListener(listener: PipelineEventListener | undefined, logger: Logger): PipelineEventListener {
  if (listener === undefined) return () => {};
  const warn = (event: PipelineEvent, error: unknown): void => {
    logger.warn("onEvent listener threw", { event: event.type, error: error instanceof Error ? error.message : String(error) });
  };
  return (event) => {
    try {
      const returned: unknown = listener(event);
      if (isThenable(returned)) returned.then(undefined, (error: unknown) => warn(event, error));
    } catch (error) {
      warn(event, error);
    }
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}
