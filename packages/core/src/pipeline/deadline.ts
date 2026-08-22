/**
 * Per-stage deadlines that stay distinguishable from a caller's abort.
 *
 * `AbortSignal.any([caller, AbortSignal.timeout(ms)])` would be shorter, but its
 * timeout fires a `DOMException` named `"TimeoutError"` — indistinguishable from a
 * caller who passed `AbortSignal.timeout()` themselves. That difference decides
 * whether fallback is allowed, so we own the timer and keep an explicit flag.
 */

import { TimeoutError } from "./errors.js";

export interface Deadline {
  /** Aborts when the caller aborts OR the deadline elapses. */
  readonly signal: AbortSignal;
  /** True only when OUR timer fired. A caller abort leaves this false. */
  expired(): boolean;
  /** Always call this — it clears the timer and detaches the listener. */
  release(): void;
}

export function withDeadline(stage: string, ms: number | undefined, caller: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;

  const onCallerAbort = (): void => {
    controller.abort((caller as { reason?: unknown }).reason);
  };

  if (caller.aborted) {
    onCallerAbort();
  } else {
    caller.addEventListener("abort", onCallerAbort, { once: true });
  }

  const timer =
    ms === undefined || ms <= 0
      ? undefined
      : setTimeout(() => {
          expired = true;
          controller.abort(new TimeoutError(stage, ms));
        }, ms);

  // Do not hold the event loop open for a deadline nobody is waiting on.
  timer?.unref?.();

  return {
    signal: controller.signal,
    expired: () => expired,
    release: () => {
      if (timer !== undefined) clearTimeout(timer);
      caller.removeEventListener("abort", onCallerAbort);
    },
  };
}
