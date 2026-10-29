import { cpus, totalmem } from "node:os";
import { solveAssignment } from "../dist/align/assignment.js";
import { defineEval, hungarian, number, ordered, text } from "../dist/index.js";

const RUNS = Number(process.env.RUNS ?? 7);
const SIZES = (process.env.SIZES ?? "250,1000").split(",").map(Number);

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["steel", "bolt", "washer", "nut", "zinc", "plated", "hex", "screw", "flange", "brass", "anchor", "rivet", "pin", "clip", "spring", "bracket"];

function rows(count, random) {
  return Array.from({ length: count }, (_unused, index) => ({
    sku: `SKU-${String(index).padStart(5, "0")}`,
    description: Array.from({ length: 3 + Math.floor(random() * 3) }, () => WORDS[Math.floor(random() * WORDS.length)]).join(" "),
    amount: Math.round(random() * 100_000) / 100,
  }));
}

function typo(value, random) {
  const at = Math.floor(random() * value.length);
  return value.slice(0, at) + String.fromCharCode(97 + Math.floor(random() * 26)) + value.slice(at + 1);
}

const OMISSION_RATE = 0.02;
const DESCRIPTION_TYPO_RATE = 0.3;
const ADJACENT_SWAP_RATE = 0.1;
const EXTRA_ROW_RATE = 0.02;

function noisy(expected, random) {
  const actual = expected
    .filter(() => random() > OMISSION_RATE)
    .map((row) => ({ ...row, description: random() < DESCRIPTION_TYPO_RATE ? typo(row.description, random) : row.description }));
  for (let i = 0; i < actual.length - 1; i += 1) if (random() < ADJACENT_SWAP_RATE) [actual[i], actual[i + 1]] = [actual[i + 1], actual[i]];
  const extras = rows(Math.ceil(expected.length * EXTRA_ROW_RATE), random).map((row) => ({ ...row, sku: `X-${row.sku}` }));
  return [...actual, ...extras];
}

const schema = {
  type: "object",
  properties: {
    lineItems: {
      type: "array",
      items: { type: "object", properties: { sku: { type: "string" }, description: { type: "string" }, amount: { type: "number" } } },
    },
  },
};

function spec(rule) {
  return defineEval(schema, {
    fields: { "lineItems[].sku": text({ minSimilarity: 1 }), "lineItems[].description": text({ minSimilarity: 0.8 }), "lineItems[].amount": number({ abs: 0.01 }) },
    arrays: { lineItems: rule },
  });
}

const VARIANTS = {
  greedy: spec(hungarian({ maxCells: 1 })),
  hungarian: spec(hungarian({ maxCells: 1e12 })),
  "exact-key + hungarian": spec(hungarian({ key: ["sku"], maxCells: 1e12 })),
  ordered: spec(ordered({ maxCells: 1e12 })),
  "ordered fallback": spec(ordered({ maxCells: 1 })),
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

console.log(`node ${process.version}, ${cpus()[0]?.model ?? "unknown cpu"}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB, ${RUNS} runs, median`);
console.log("| rows | algorithm | median ms | matched | f1 |");
console.log("|---:|---|---:|---:|---:|");
for (const size of SIZES) {
  const random = rng(size);
  const expected = { lineItems: rows(size, random) };
  const actual = { lineItems: noisy(expected.lineItems, random) };
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const times = [];
    let score;
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      score = variant.score(expected, actual);
      times.push(performance.now() - started);
    }
    const report = score.arrays[0];
    console.log(`| ${size} | ${name} (${report.algorithm}) | ${median(times).toFixed(1)} | ${report.matched}/${size} | ${score.metrics.f1.toFixed(4)} |`);
  }
}

console.log("\nAssignment solver alone on uniform random costs:");
console.log("| size | median ms |");
console.log("|---:|---:|");
for (const size of SIZES) {
  const random = rng(size + 1);
  const cost = Float64Array.from({ length: size * size }, () => random());
  const times = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    solveAssignment(cost, size, size);
    times.push(performance.now() - started);
  }
  console.log(`| ${size}x${size} | ${median(times).toFixed(1)} |`);
}
