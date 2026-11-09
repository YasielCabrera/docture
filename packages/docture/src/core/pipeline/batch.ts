import { positiveInteger } from "./options.js";

export function batchConcurrency(concurrency = 4): number {
  return positiveInteger("concurrency", concurrency);
}
