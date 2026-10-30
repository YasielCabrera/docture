# Using @docture/eval

Read this file explicitly before writing evaluation code for an application that
uses `@docture/eval`. A coding agent can read `node_modules/@docture/eval/AGENTS.md`;
automatic discovery inside dependencies is not assumed. The documentation site's
`/llms.txt` lists every guide as Markdown.

```sh
npm install @docture/eval docture zod
```

Describe how to score a schema once with `defineEval`, run experiments over a
dataset with `runEval`, and keep the versioned result. Every report, comparison
and gate reads that result, so re-rendering never re-runs extraction.

```ts
import { defineEval, exact, gate, inMemoryDataset } from "@docture/eval";
import { runEval } from "@docture/eval/runner";
import { z } from "zod";

const schema = z.object({ title: z.string(), count: z.number() });
const spec = defineEval(schema, { strings: exact() });
const dataset = inMemoryDataset("inventory", [{
  id: "one",
  documents: [],
  expected: { title: "Screws", count: 12 },
}]);
const result = await runEval({
  dataset,
  spec,
  experiments: {
    parser: { id: "parser", async extract() { return { raw: { title: "Screws", count: 12 } }; } },
  },
});
const verdict = gate(result, { thresholds: [{ metric: "f1", min: 0.95 }] });
```

Import each capability from its own entry: `@docture/eval/node` for filesystem
datasets and run storage, `@docture/eval/docture` to adapt a docture extractor,
`@docture/eval/compare` for paired comparisons, and `@docture/eval/reporters/*`
for terminal, JSON, Markdown, CSV, JUnit and HTML output. The root entry does not
read files.

Ground truth belongs to the project. Change it through the dataset tools so
fingerprints and migrations stay auditable; never edit expected values to make a
run pass. Compare a candidate against a stored baseline run, not against a number
copied into code.

`@docture/eval/judge` compares strings through an AI SDK model and needs
`npm install ai`. Model calls are not bitwise deterministic even at temperature
zero; report judged scores separately from exact comparators, and use cached
verdicts in CI.

Read a corpus from `@docture/synthetic` with `jsonlDataset` from
`@docture/eval/node`; its manifest carries tags and label locations for slicing
and grounding.
