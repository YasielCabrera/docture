import { gzipSync } from "node:zlib";
import { buildResult, defineEval, hungarian, number, text } from "../dist/index.js";

const CASES = Number(process.env.CASES ?? 360);
const ROWS = 38;

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

const HEADER = Array.from({ length: 20 }, (_unused, index) => `field${index}`);
const ROW_FIELDS = ["sku", "description", "plate", "procedure", "unit", "quantity", "price", "amount", "tax", "discount"];
const NUMERIC = new Set(["quantity", "price", "amount", "tax", "discount"]);

const schema = {
  type: "object",
  properties: {
    ...Object.fromEntries(HEADER.map((name, index) => [name, { type: index % 2 === 0 ? "string" : "number" }])),
    lineItems: {
      type: "array",
      items: { type: "object", properties: Object.fromEntries(ROW_FIELDS.map((name) => [name, { type: NUMERIC.has(name) ? "number" : "string" }])) },
    },
  },
};

const spec = defineEval(schema, {
  strings: text({ minSimilarity: 0.9 }),
  arrays: { lineItems: hungarian({ key: ["sku"] }) },
});

function value(name, random, numeric) {
  return numeric ? Math.round(random() * 100_000) / 100 : `${name} ${Math.floor(random() * 1e6).toString(36)} ${Math.floor(random() * 1e6).toString(36)}`;
}

function document(random) {
  return {
    ...Object.fromEntries(HEADER.map((name, index) => [name, value(name, random, index % 2 === 1)])),
    lineItems: Array.from({ length: ROWS }, (_unused, row) => Object.fromEntries(ROW_FIELDS.map((name) => [name, name === "sku" ? `SKU-${row}` : value(name, random, NUMERIC.has(name))]))),
  };
}

function perturb(input, random) {
  const copy = structuredClone(input);
  for (const name of HEADER) if (random() < 0.05) copy[name] = typeof copy[name] === "number" ? copy[name] + 1 : `${copy[name]}x`;
  for (const row of copy.lineItems) for (const name of ROW_FIELDS) if (name !== "sku" && random() < 0.05) row[name] = NUMERIC.has(name) ? row[name] * 10 : null;
  return copy;
}

const random = rng(360);
const started = new Date().toISOString();
const cases = Array.from({ length: CASES }, (_unused, index) => {
  const expected = document(random);
  const actual = perturb(expected, random);
  return {
    caseId: `case-${String(index).padStart(4, "0")}`,
    experiment: "default",
    epoch: 0,
    tags: { rendition: ["digital", "scan", "scan-lq"][index % 3] },
    group: `doc-${Math.floor(index / 3)}`,
    usage: { inputTokens: 4000, outputTokens: 900, costUsd: 0.012 },
    startedAt: started,
    ms: 1200,
    outcome: "scored",
    expected,
    actual,
    score: spec.score(expected, actual),
  };
});

const result = buildResult({
  run: {
    id: "size-check",
    status: "complete",
    startedAt: started,
    dataset: { id: "synthetic", size: CASES, fingerprint: "0000000000000000" },
    spec: spec.info,
    experiments: [{ id: "default", configHash: "0000000000000000" }],
    epochs: 1,
  },
  cases,
});

const { cases: rows, ...rest } = result;
const lines = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const header = JSON.stringify(rest);
const leaves = rows[0].score.fields.length;
const mb = (bytes) => `${(bytes / 2 ** 20).toFixed(2)} MiB`;
console.log(`${CASES} cases, ${leaves} graded leaves in the first case`);
console.log(`cases.jsonl: ${mb(Buffer.byteLength(lines))} (${Math.round(Buffer.byteLength(lines) / CASES / 1024)} KiB per case), gzip ${mb(gzipSync(lines).length)}`);
console.log(`result.json without cases: ${(Buffer.byteLength(header) / 1024).toFixed(1)} KiB`);
const fieldsOnly = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.score.fields)), 0);
console.log(`share of cases.jsonl in score.fields: ${((fieldsOnly / Buffer.byteLength(lines)) * 100).toFixed(0)}%`);
