import { withDeadline, type Deadline } from "./deadline.js";
import { CALL_STAGE } from "./errors.js";
import { positiveNumber } from "./options.js";

/** A plugin that settles inside its own abort listener still wins the race against the deadline. */
function afterPluginTurn(run: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(run, 0);
}

export function abandonAfterDeadline<T>(work: Promise<T>, deadline: Deadline): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abandon = (): void => {
      if (deadline.expired()) timer = afterPluginTurn(() => reject(deadline.signal.reason));
    };
    const settle = (): void => {
      deadline.signal.removeEventListener("abort", abandon);
      if (timer !== undefined) clearTimeout(timer);
    };
    if (deadline.signal.aborted) abandon();
    else deadline.signal.addEventListener("abort", abandon, { once: true });
    work.then(
      (value) => { settle(); resolve(value); },
      (error: unknown) => { settle(); reject(error); },
    );
  });
}

export async function withCallDeadline<T>(
  ms: number | undefined,
  caller: AbortSignal | undefined,
  work: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (ms === undefined) return work(caller);
  positiveNumber("timeoutMs", ms);
  const deadline = withDeadline(CALL_STAGE, ms, caller ?? new AbortController().signal);
  try {
    const result = await abandonAfterDeadline(work(deadline.signal), deadline);
    deadline.signal.throwIfAborted();
    return result;
  } catch (error) {
    throw deadline.expired() ? deadline.signal.reason : error;
  } finally {
    deadline.release();
  }
}
