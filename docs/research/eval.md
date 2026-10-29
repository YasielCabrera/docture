# Eval research: prior art, schema annotations, alignment and result size

Status: phase 0 findings for `@docture/eval`. Date: 2026-10-28.

The scripts behind every number live in `packages/eval/bench/`. Build first, then run any of them:

```sh
pnpm --filter @docture/eval build
node packages/eval/bench/zod-meta.mjs
node packages/eval/bench/alignment.mjs
node packages/eval/bench/result-size.mjs
```

Measurements below ran on Node 24.14.0, Apple M4 Max, 14 cores, 36 GiB.

## Prior art

The survey in ticket T-164 (2026-10-28) stands. It was not re-verified against the sources for this note. No TypeScript library scores structured extraction field by field. The design takes one idea from each of these:

| Source | What `@docture/eval` takes |
|---|---|
| AWS Stickler | Per-field comparators, weights and thresholds configured from a schema. `spec.explain(path)`. |
| ExtractBench | Value precision, recall and F1 over leaves. Optimal assignment for lists. Grounding as correct and supported at IoU 0.5. |
| ANLS\* | ANLS as a secondary per-case score, through `text({ metric: "anls" })` and the `anls` metric. |
| Object Aligner | Optimal assignment for unordered rows and order-preserving alignment for ordered ones. Repair hints on mismatches. |
| DocILE | Slices over tags. Confidence-aware AP belongs to the calibration report. |
| Braintrust, LangSmith | Baseline runs and per-metric deltas. Filled by `@docture/eval/compare`. |
| Inspect AI | Per-case scores kept apart from dataset metrics. Epochs with a variance summary. |
| Evalite, vitest-evals, promptfoo, autoevals | Adapters on narrow entries rather than a competing runner UI. |

OpenAI Evals shuts down on 2026-11-30, so nothing depends on it.

## Schema annotations through `asSchema`

**Zod 4 keeps the annotation.** A `.meta({ "x-docture-eval": … })` value reaches `asSchema(schema).jsonSchema` from `@ai-sdk/provider-utils` 5.0.20 unchanged, on the property itself or beside the `anyOf` of a nullable field:

```json
{
  "type": "object",
  "properties": {
    "total": { "type": "number", "x-docture-eval": { "compare": "number", "abs": 0.01 } },
    "iban": { "anyOf": [{ "type": "string" }, { "type": "null" }], "x-docture-eval": "identifier" }
  },
  "required": ["total", "iban"],
  "additionalProperties": false
}
```

`defineEval` resolves both fields from the annotation: `total: number(abs 0.01)` and `iban: identifier()`.

**Zod 3 loses it.** Zod 3 has no `.meta()`. `.describe()` only sets `description`, so an annotation cannot be attached. Zod 3 users declare comparators in `defineEval` rules, which work for every schema library.

**`@docture/eval` reads JSON Schema without importing the AI SDK.** It follows the same branches as `asSchema`:

- an AI SDK schema object exposes `jsonSchema`;
- a Standard Schema exposes `~standard.jsonSchema.input()`;
- a lazy schema is a function that returns one of these.

Zod 4.2 and later implement Standard JSON Schema. Zod 4.1.8 and 4.1.12 do not. A Zod 3 or Zod 4.1 schema therefore needs `zodSchema(schema)` from `ai`, or plain JSON Schema. `defineEval` says so in its error. The route avoids a direct dependency on `@ai-sdk/provider-utils`. Adding that dependency later would only change `src/spec/schema-source.ts`.

## Alignment benchmark

`alignment.mjs` builds rows of three fields: an identifier-like `sku`, a description scored by `text` and an amount scored by `number`. The actual rows reorder neighbours, put a typo in 30% of descriptions, drop 2% of rows and add 2% invented rows. Each cell is the median of 7 full `spec.score` calls.

| Rows | Algorithm | Median ms | Matched | F1 |
|---:|---|---:|---:|---:|
| 250 | greedy | 64.0 | 244/250 | 0.9759 |
| 250 | optimal assignment | 247.8 | 248/250 | 0.9692 |
| 250 | exact key, then optimal assignment | 1.6 | 246/250 | 0.9759 |
| 250 | ordered | 246.5 | 228/250 | 0.8394 |
| 250 | ordered fallback (`ordered-greedy`) | 62.7 | 217/250 | 0.8675 |
| 500 | greedy | 130.4 | 490/500 | 0.9800 |
| 500 | optimal assignment | 999.5 | 499/500 | 0.9780 |
| 500 | exact key, then optimal assignment | 2.8 | 498/500 | 0.9800 |
| 500 | ordered | 992.6 | 469/500 | 0.8320 |
| 500 | ordered fallback (`ordered-greedy`) | 129.2 | 437/500 | 0.8640 |
| 1,000 | greedy | 261.6 | 987/1000 | 0.9836 |
| 1,000 | optimal assignment | 4042.7 | 1000/1000 | 0.9836 |
| 1,000 | exact key, then optimal assignment | 6.1 | 1000/1000 | 0.9836 |
| 1,000 | ordered | 4024.9 | 946/1000 | 0.8630 |
| 1,000 | ordered fallback (`ordered-greedy`) | 262.4 | 898/1000 | 0.8899 |

Measured with `SIZES=250,500,1000 node packages/eval/bench/alignment.mjs` on Node 24.14.0, Apple M4 Max, 7 runs per cell. The greedy, optimal and keyed rows match the first measurement within noise. Row similarity now walks nested arrays too, and on these flat rows it gives the same pairs.

`ordered` is the wrong rule for this workload, which swaps neighbours. An order-preserving alignment must leave one row of every swapped pair unpaired. The exact `ordered` maximizes total similarity, so it also pairs 80 rows with the wrong `sku` at 1,000 rows, because two mediocre pairs outscore one exact pair. The fallback accepts the most similar pairs first and pairs 5 such rows, so its F1 is higher although it matches fewer rows. On data whose order is part of the truth, `ordered` is exact and the fallback is an approximation.

The solver is not the cost. On uniform random costs it takes 3.2 ms at 250 × 250, 14.5 ms at 500 × 500 and 64.6 ms at 1,000 × 1,000. The rest of the unkeyed time is the similarity matrix: one comparator call per field per cell, about 4 µs per cell with three fields. Rows with more fields cost proportionally more.

The solver uses shortest augmenting paths with dual potentials, the augmentation scheme of Jonker and Volgenant, without their initialization heuristics. A test checks it against brute force on 300 random matrices up to 6 × 6.

The first greedy version paired each expected row in order with its best unpaired neighbour. A dropped row then stole its neighbour's partner and the error cascaded: F1 0.70 at 1,000 rows. The shipped greedy collects candidate pairs within 32 positions of each row's proportional place and accepts them from most to least similar. It matches the exact methods' F1 on this local-reordering workload. It is not optimal for large-distance reordering. The `ordered` fallback uses the same candidates and skips any pair that would cross a pair it already accepted, so its pairs keep both orders.

**Decisions.**

- `DEFAULT_MAX_CELLS` is 250,000, a 500 × 500 matrix. Past it, optimal assignment over an unkeyed array costs about a second per array per case on this machine, and greedy reaches the same F1 on this workload. Above the budget, `hungarian` records `algorithm: "greedy"`, `ordered` records `algorithm: "ordered-greedy"`, and `buildResult` adds a warning. `maxCells` raises the budget per rule.
- A keyed `hungarian` applies the budget to each bucket of rows that share a key and to the unkeyed rest. A bucket over the budget is paired greedily and the array records `algorithm: "greedy"`.
- Exact-key blocking is not mandatory. It is the recommended configuration for long tables: it is two orders of magnitude faster and pairs every row in the buckets exactly. The greedy warning text tells the user to add a key.

## Result size

`result-size.mjs` scores 360 cases of 400 leaves each: 20 header fields and 38 rows of 10 fields, with 5% of values perturbed.

| Artifact | Size |
|---|---:|
| `cases.jsonl` | 32.31 MiB, 92 KiB per case |
| `cases.jsonl` gzipped | 2.99 MiB |
| `result.json` without cases | 14.8 KiB |

The rows are the ones `buildResult` returns, so each carries its per-case metric values, about 0.4 KiB. `score.fields` is 80% of `cases.jsonl`. Each field result repeats its path, pattern, segment, comparator and both values. `result.json` stays small, so listing runs, picking baselines and gating never read the cases.

HTML report size for the same corpus, rendering the `result-size.mjs` result with `renderHtml`:

| `detail` | Size | Gzipped |
|---|---:|---:|
| `all` | 32.42 MiB | 3.00 MiB |
| `failures` | 1.98 MiB | 0.13 MiB |

`all` embeds the whole result, so it tracks `cases.jsonl`. `failures` keeps the 6,369 leaves that did not match and drops both documents of every case. Chrome opens the `failures` file and renders all 360 table rows in under a second. The default is `failures` at every corpus size, so the report stays small without a size threshold to tune. `detail: "all"` remains available, and `result.json` with `cases.jsonl` holds every field.

## pfnur rebuild against the implemented API

Read-only source census: `apps/eval/src` in the pfnur monorepo, 2026-10-28. Counts below are physical lines from `wc -l`, including comments. Reporting includes its HTML/CSS assets and client config. These are replacement sketches, not edits to pfnur. Generator tooling is outside this migration.

The schema lists the real statement fields. The processor preserves the current `process({ bytes, mimeType, fileName, ref })` contract and projects raw results. Eval supplies discovery, scoring, execution, storage and report shells. The sketch deliberately sets method weight to zero across experiments: forced acquisition and LLM methods are diagnostics, not accuracy evidence. Weight zero excludes method from weighted precision, recall and F1, but its mismatches still lower unweighted `exact`. Restoring method scoring for routed-only runs requires a separate spec.

`folderDataset` ignores dot folders. The explicit `include` list below also excludes pfnur's `_upload` scratch directory. The `photo` and `scan-lq` suffixes are removed as whole suffixes; an unsuffixed id is `digital`, so three renditions of one document share a group.

| Existing area | Current lines | Replacement |
| --- | ---: | --- |
| Truth and spec | 379 | Built-ins plus project blocks below |
| Scoring and alignment (`core/align.ts` 220, `core/compare.ts` 183, `core/scorer.ts` 213, `core/metrics.ts` 56, `core/types.ts` 229) | 901 | Built-ins plus project blocks below |
| Dataset and sampling | 241 | Built-ins plus project blocks below |
| Execution and history | 860 | Built-ins plus project blocks below |
| Reporting | 4318 | Built-ins plus project blocks below |
| Two migrations | 189 | Built-ins plus project blocks below |
| Drafting | 124 | Built-ins plus project blocks below |

The 6 blocks below contain 283 physical lines. Pipeline implementation and schema package code remain project-owned. No live pipeline or model was run.

### `spec.ts`

```ts
import { z } from "zod";
import { STATEMENT_ISSUERS } from "@pfnur/document-processing";
import {
  defineEval, exact, identifier, date, number, text, ordered,
} from "@docture/eval";

const string = z.string().nullable().optional();
const amount = z.number().nullable().optional();
const DetailsSchema = z.strictObject({
  statementNumber: string,
  customerNumber: string,
  statementDate: string,
  periodStart: string,
  periodEnd: string,
  recipientName: string,
  recipientAddress: string,
  currency: string,
  hasOfficialEmblem: z.boolean().nullable().optional(),
});
const TotalsSchema = z.strictObject({
  total: amount,
  totalKm: amount,
  externalCosts: amount,
  infrastructureCosts: amount,
  expectedReturn: amount,
  totalCancellationFees: amount,
});
const LineItemSchema = z.strictObject({
  country: string,
  licensePlate: string,
  procedure: string,
  km: amount,
  externalCosts: amount,
  amount,
});
const TopUpSchema = z.strictObject({
  recipient: string,
  bank: string,
  iban: string,
  bic: string,
  reference: string,
});
const PaymentSchema = z.strictObject({
  method: string,
  dueDate: string,
  payerIban: string,
  payerBank: string,
  payerBic: string,
  mandateReference: string,
  creditorId: string,
  topUp: TopUpSchema.nullable().optional(),
});
export const ScoredViewSchema = z.strictObject({
  issuer: z.enum(STATEMENT_ISSUERS),
  method: z.enum(["TEXT_LAYER", "OCR"]).nullable(),
  extraction: z.strictObject({
    details: DetailsSchema,
    totals: TotalsSchema,
    payment: PaymentSchema.nullable().optional(),
    lineItems: z.array(LineItemSchema),
  }),
});
export type ScoredView = z.infer<typeof ScoredViewSchema>;
export const statementEval = defineEval(ScoredViewSchema, {
  strings: exact({ normalize: "case-and-whitespace" }),
  fields: {
    issuer: { critical: true },
    method: { weight: 0 },
    "extraction.details.statementNumber": identifier(),
    "extraction.details.customerNumber": identifier(),
    "extraction.details.statementDate": date(),
    "extraction.details.periodStart": date(),
    "extraction.details.periodEnd": date(),
    "extraction.details.recipientAddress": text({ metric: "anls", minSimilarity: 0.9 }),
    "extraction.totals.*": number({ abs: 0.01 }),
    "extraction.payment.dueDate": date(),
    "extraction.payment.payerIban": identifier(),
    "extraction.payment.topUp.iban": identifier(),
    "extraction.lineItems[].licensePlate": identifier(),
    "extraction.lineItems[].km": number({ abs: 0.01 }),
    "extraction.lineItems[].externalCosts": number({ abs: 0.01 }),
    "extraction.lineItems[].amount": number({ abs: 0.01 }),
  },
  arrays: { "extraction.lineItems": ordered() },
  segments: {
    routing: ["issuer", "method"],
    details: "extraction.details",
    totals: "extraction.totals",
    payment: "extraction.payment",
    rows: "extraction.lineItems",
  },
});
```

### `dataset.ts`

```ts
import { readdir } from "node:fs/promises";
import { folderDataset } from "@docture/eval/node";
import { ScoredViewSchema } from "./spec.js";

const include = (await readdir("dataset", { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
  .map(entry => entry.name);
const rendition = (id: string) => /-(scan-lq|photo)$/.exec(id)?.[1] ?? "digital";

export const dataset = folderDataset("dataset", {
  include,
  documents: "doc.pdf",
  expected: "expected.json",
  draft: "expected.draft.json",
  toExpected: value => ScoredViewSchema.parse(value),
  tags: id => ({ rendition: rendition(id) }),
  group: id => id.replace(/-(scan-lq|photo)$/, ""),
  drafts: "error",
});
```

### `processor.ts`

```ts
import {
  createDocumentProcessor, NoEligibleStrategyError,
  type ProcessingResult,
} from "@pfnur/document-processing";
import { OutOfScopeError, type EvalExtractor } from "@docture/eval";
import type { ScoredView } from "./spec.js";

export function processor(mode: "auto" | "ocr" | "text-layer"):
  EvalExtractor<ProcessingResult, ScoredView> {
  let pipeline: ReturnType<typeof createDocumentProcessor> | undefined;
  return {
    id: mode,
    config: { mode, projection: 1 },
    async preflight() {
      pipeline = createDocumentProcessor(
        mode === "ocr" ? { textLayer: false } :
        mode === "text-layer" ? { ocr: false } : { env: process.env },
      );
    },
    async extract(item, ctx) {
      ctx.signal.throwIfAborted();
      const document = item.documents[0];
      if (!document || item.documents.length !== 1) {
        throw new Error("Expected one PDF per statement");
      }
      if (!pipeline) throw new Error("Processor has not passed preflight");
      try {
        const result = await pipeline.process({
          bytes: await document.bytes(),
          mimeType: document.mimeType,
          fileName: document.name,
          ref: item.id,
        }, undefined, ctx.signal);
        ctx.signal.throwIfAborted();
        return {
          raw: result,
          method: result.method,
          fallback: result.attempts.length > 1,
          diagnostics: { issuer: result.issuer },
        };
      } catch (error) {
        if (mode === "text-layer" && error instanceof NoEligibleStrategyError &&
            !error.features.hasTextLayer) {
          throw new OutOfScopeError("no text layer", { cause: error });
        }
        throw error;
      }
    },
    project(result) {
      return {
        issuer: result.issuer,
        method: mode !== "auto" ? null : result.method === "TEXT_LAYER" ? "TEXT_LAYER" : result.method === "OCR" ? "OCR" : null,
        extraction: {
          details: { ...result.extraction.details },
          totals: { ...result.extraction.totals },
          payment: result.extraction.payment ?? null,
          lineItems: result.extraction.lineItems.map(row => ({ ...row })),
        },
      };
    },
    async dispose() {
      await pipeline?.dispose();
      pipeline = undefined;
    },
  };
}
```

### `columns.ts`

```ts
import { defineColumn } from "@docture/eval/reporters/terminal";

export const issuerColumn = defineColumn({
  id: "issuer",
  header: "Issuer",
  priority: 1,
  value: row => {
    if (row.outcome !== "scored") return null;
    const actual = row.actual;
    return actual !== null && typeof actual === "object" && "issuer" in actual &&
      typeof actual.issuer === "string" ? actual.issuer : null;
  },
});
export const fallbackColumn = defineColumn({
  id: "fallback",
  header: "Fallback",
  priority: 2,
  value: row => row.fallback ?? null,
});
```

### `docture.eval.ts`

```ts
import { defineEvalConfig } from "@docture/eval/config";
import { terminalReporter, defaultColumns } from "@docture/eval/reporters/terminal";
import { htmlReporter } from "@docture/eval/reporters/html";
import { markdownReporter } from "@docture/eval/reporters/markdown";
import { junitReporter } from "@docture/eval/reporters/junit";
import { dataset } from "./dataset.js";
import { statementEval } from "./spec.js";
import { processor } from "./processor.js";
import { issuerColumn, fallbackColumn } from "./columns.js";

const columns = [...defaultColumns(), issuerColumn, fallbackColumn];
export default defineEvalConfig({
  dataset,
  spec: statementEval,
  experiments: {
    routed: processor("auto"),
    ocr: processor("ocr"),
    text: processor("text-layer"),
  },
  slices: { rendition: "tags.rendition" },
  reporters: [
    terminalReporter({ columns }),
    htmlReporter({ out: "eval-report.html", columns }),
    markdownReporter({ out: "eval-report.md", columns }),
    junitReporter({ out: "junit.xml" }),
  ],
  gate: { thresholds: [{ metric: "f1", min: 0.95 }] },
  store: ".docture/eval",
  baseline: "auto",
  concurrency: 4,
});
```

### `migrations.ts`

```ts
import { z } from "zod";
import { defineMigration } from "@docture/eval/dataset";
import { decomposeToll, round2 } from "@pfnur/document-processing/derive";
import { ScoredViewSchema, type ScoredView } from "./spec.js";

export const recipientAddress = defineMigration<ScoredView>({
  id: "recipient-address-without-name",
  description: "Remove the recipient name prefix from the postal address",
  targets: ["extraction.details.recipientAddress"],
  apply(expected) {
    const { recipientName: name, recipientAddress: address } = expected.extraction.details;
    if (!name || !address || !address.startsWith(name)) return expected;
    const rest = address.slice(name.length).replace(/^,\s*/, "");
    if (rest.startsWith(name)) throw new Error("Repeated name prefix needs human review");
    return {
      ...expected,
      extraction: {
        ...expected.extraction,
        details: { ...expected.extraction.details, recipientAddress: rest || null },
      },
    };
  },
});
const LegacyTotals = z.object({
  total: z.number().nullable(),
  externalCosts: z.number().nullable(),
  infrastructureCosts: z.number().nullable(),
  refundPotential: z.number().nullable(),
}).passthrough();
const LegacyTruth = z.object({
  extraction: z.object({ totals: LegacyTotals }).passthrough(),
}).passthrough();

export const expectedReturn = defineMigration<unknown>({
  id: "expected-return-at-current-rate",
  description: "Rename a verified legacy refund and rederive its current rate",
  targets: ["extraction.totals.refundPotential", "extraction.totals.expectedReturn"],
  apply(input) {
    if (ScoredViewSchema.safeParse(input).success) return input;
    const expected = LegacyTruth.parse(input);
    const old = expected.extraction.totals;
    const derived = decomposeToll(old.total, old.externalCosts);
    const legacy = derived.infrastructureCosts === null ? null :
      round2(derived.infrastructureCosts * 0.05);
    if (derived.infrastructureCosts !== old.infrastructureCosts || legacy !== old.refundPotential) {
      throw new Error("Legacy truth was edited; review it before migration");
    }
    const { refundPotential, ...totals } = old;
    return ScoredViewSchema.parse({
      ...expected,
      extraction: { ...expected.extraction, totals: { ...totals, expectedReturn: derived.expectedReturn } },
    });
  },
});

export const migration = recipientAddress;
```

Run `runMigration(dataset, recipientAddress, { spec: statementEval })` for a dry run and add `write: true` only after reviewing the diff. For legacy truth, use a separate `folderDataset<unknown>` without `toExpected` so discovery does not reject the old keys before `expectedReturn` can inspect them. Both transformations are idempotent; eval checks allowed targets and validates all outputs before writes. The existing payment rebake needs a separate project migration and is not represented by these two examples.

Use `docture eval run`, `report`, `compare`, `gate`, `sample`, `validate`, `migrate`, and `draft` through the shared CLI. Saved results can be re-rendered or compared without another pipeline call. `DocumentProcessor.process(input, options, signal)` accepts an `AbortSignal`; the adapter passes `ctx.signal` as its third argument. `migrations.ts` exports `migration` for `docture eval migrate ./migrations.ts`. To run the second migration, change that export to `expectedReturn`.
