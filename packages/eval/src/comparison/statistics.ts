import { compareCodeUnits, percentile } from "../index.js";

/** One paired metric observation and its independent sampling unit. */
export interface PairValue {
  readonly before: number;
  readonly after: number;
  readonly cluster: string;
}

function fnv1aSeededMulberry32(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const EXACT_SIGN_FLIP_CLUSTER_LIMIT = 20;

function exactSignFlipProbability(sums: readonly number[]): number {
  const observed = Math.abs(sums.reduce((sum, value) => sum + value, 0));
  let signed = sums.reduce((sum, value) => sum + value, 0);
  let extreme = 0;
  const total = 2 ** sums.length;
  for (let mask = 0; mask < total; mask++) {
    if (Math.abs(signed) >= observed - 1e-12 * Math.max(1, observed)) extreme++;
    const changed = (mask + 1) & -(mask + 1);
    const index = 31 - Math.clz32(changed);
    if (index < sums.length) {
      const gray = mask ^ (mask >>> 1);
      signed += ((gray & changed) === 0 ? -2 : 2) * sums[index]!;
    }
  }
  return extreme / total;
}

/** Percentile interval and two-sided tail probability of clustered mean differences. */
export function bootstrap(
  pairs: readonly PairValue[],
  resamples: number,
  seed: string,
  alpha: number,
): { ci: readonly [number, number]; p: number } {
  const groups = new Map<string, { sum: number; count: number }>();
  for (const pair of pairs) {
    const group = groups.get(pair.cluster) ?? { sum: 0, count: 0 };
    group.sum += pair.after - pair.before;
    group.count++;
    groups.set(pair.cluster, group);
  }
  const clusters = [...groups].sort(([a], [b]) => compareCodeUnits(a, b)).map(([, group]) => group);
  const next = fnv1aSeededMulberry32(seed);
  const samples: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < clusters.length; j++) {
      const cluster = clusters[Math.floor(next() * clusters.length)]!;
      sum += cluster.sum;
      count += cluster.count;
    }
    samples.push(sum / count);
  }
  let p: number;
  if (clusters.length <= EXACT_SIGN_FLIP_CLUSTER_LIMIT) {
    p = exactSignFlipProbability(clusters.map((cluster) => cluster.sum));
  } else {
    p = Math.min(1, (2 * (1 + Math.min(samples.filter((v) => v <= 0).length, samples.filter((v) => v >= 0).length))) / (resamples + 1));
  }
  return {
    ci: [percentile(samples, alpha / 2)!, percentile(samples, 1 - alpha / 2)!],
    p,
  };
}

/** Exact two-sided binomial probability of the discordant binary pairs. */
export function mcnemar(pairs: readonly PairValue[]): number {
  const gains = pairs.filter((p) => p.before === 0 && p.after === 1).length;
  const losses = pairs.filter((p) => p.before === 1 && p.after === 0).length;
  const n = gains + losses;
  if (n === 0) return 1;
  let logTerm = -n * Math.LN2;
  let term = 2 ** -n;
  let sum = term;
  for (let k = 1; k <= Math.min(gains, losses); k++) {
    logTerm += Math.log(n - k + 1) - Math.log(k);
    term = n < 1023 ? (term * (n - k + 1)) / k : Math.exp(logTerm);
    sum += term;
  }
  return Math.min(1, 2 * sum);
}
