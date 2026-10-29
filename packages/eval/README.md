# @docture/eval

Evaluate structured extraction with schema-driven specs, project-owned datasets and one versioned result format. Compare runs, gate changes and render saved results offline.

## Install

```sh
npm install @docture/eval docture zod
# Only for @docture/eval/judge:
npm install ai
```

## Quick start

```ts
import { defineEval, exact, inMemoryDataset, gate } from "@docture/eval";
import { runEval } from "@docture/eval/runner";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { renderHtml } from "@docture/eval/reporters/html";
import { z } from "zod";

const schema = z.object({ title: z.string(), count: z.number() });
const spec = defineEval(schema, { strings: exact() });
const dataset = inMemoryDataset("inventory", [{
  id: "one",
  documents: [],
  expected: { title: "Screws", count: 12 },
}]);
const result = await runEval({
  dataset, spec,
  experiments: {
    parser: {
      id: "parser",
      async extract() { return { raw: { title: "Screws", count: 12 } }; },
    },
  },
});
console.log(renderScoreboard(result));
const html = renderHtml(result);
const verdict = gate(result, { thresholds: [{ metric: "f1", min: 0.95 }] });
console.log(verdict.pass, html.length);
```

## Entry points

| Import | Capability |
| --- | --- |
| `@docture/eval` | Specs, comparators, metrics, results, gate and baseline resolution |
| `@docture/eval/config` | Configuration for datasets, experiments, reporters and gates |
| `@docture/eval/dataset` | Fingerprints, sampling, drafts and guarded truth migrations |
| `@docture/eval/runner` | Concurrent extraction, result sections, resume and re-scoring |
| `@docture/eval/node` | Filesystem datasets, run storage, Git provenance and atomic artifacts |
| `@docture/eval/docture` | Adapt a Docture extractor and project its raw output |
| `@docture/eval/compare` | Paired run comparison, bootstrap intervals and regression verdicts |
| `@docture/eval/calibration` | Confidence coverage, reliability bins and auto-accept thresholds |
| `@docture/eval/grounding` | Score extraction evidence against expected locations |
| `@docture/eval/conversion` | Conversion content checks |
| `@docture/eval/reporters/terminal` | Terminal scoreboards and custom columns |
| `@docture/eval/reporters/json` | JSON results and split JSONL artifacts |
| `@docture/eval/reporters/markdown` | Composable Markdown sections and tables |
| `@docture/eval/reporters/csv` | Delimited case tables with custom columns |
| `@docture/eval/reporters/junit` | JUnit XML for CI test reports |
| `@docture/eval/reporters/html` | Offline HTML dashboards, panels and themes |
| `@docture/eval/reporters/template` | Custom rendering functions and artifact writers |
| `@docture/eval/judge` | Cached semantic string comparison through the optional AI SDK |
| `@docture/eval/vitest` | Async extraction matchers and dataset tests |
| `@docture/eval/evalite` | Structural Evalite scoring object |
| `@docture/eval/promptfoo` | Structural promptfoo JavaScript assertion |
| `@docture/eval/autoevals` | Structural autoevals F1 scorer |

The judge compares string leaves through `scoreAsync`. Temperature zero and cached structured verdicts improve repeatability; model providers do not guarantee bitwise determinism. An aligned array still needs a synchronous weighted field for pairing rows.

[Guide](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/evaluation/quick-start.mdx) · [API](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/evaluation/reference.mdx) · [Migration](https://github.com/YasielCabrera/docture/blob/main/apps/docs/content/docs/resources/migration.mdx)
