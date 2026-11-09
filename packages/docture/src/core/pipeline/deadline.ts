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

/**
 * The longest delay `setTimeout` honours; a longer one fires after 1 ms. A deadline past it
 * (about 24.8 days) cannot elapse within a run, so it sets no timer.
 */
const MAX_TIMER_MS = 2_147_483_647;

export function withDeadline(stage: string, ms: number | undefined, caller: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onCallerAbort = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort((caller as { reason?: unknown }).reason);
  };

  if (caller.aborted) {
    onCallerAbort();
  } else {
    caller.addEventListener("abort", onCallerAbort, { once: true });
    timer = ms === undefined || ms <= 0 || ms > MAX_TIMER_MS
      ? undefined
      : setTimeout(() => {
          expired = true;
          controller.abort(new TimeoutError(stage, ms));
        }, ms);
  }

  return {
    signal: controller.signal,
    expired: () => expired,
    release: () => {
      if (timer !== undefined) clearTimeout(timer);
      caller.removeEventListener("abort", onCallerAbort);
    },
  };
}
