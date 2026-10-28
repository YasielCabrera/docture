export function batchConcurrency(concurrency = 4): number {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  return concurrency;
}
