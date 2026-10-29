import { Code } from "./code";
import { LoopTabs } from "./loop-tabs";
import { CodeWindow, Section } from "./section";

interface LoopStep {
  readonly id: string;
  readonly title: string;
  readonly packageName: string;
  readonly description: string;
  readonly file: string;
  readonly code: string;
}

const loopSteps: readonly LoopStep[] = [
  {
    id: "extract",
    title: "Extract",
    packageName: "docture",
    description:
      "Load a PDF, scan, or email. Run deterministic parsers first, then any AI SDK model, and get data validated against the schema.",
    file: "extract.ts",
    code: `import { Extractor, contract } from "docture";
import { LLM } from "docture/llm";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const Invoice = contract({
  name: "invoice",
  schema: z.object({
    invoiceNumber: z.string(),
    total: z.number(),
  }),
});

const extractor = new Extractor()
  .loadDocumentLoader(new DocumentLoaderPdfJs())
  .loadLlm(new LLM(openai("gpt-5")));

const result = await extractor.extract(
  "invoice.pdf",
  Invoice,
);
result.data.total; // number`,
  },
  {
    id: "generate",
    title: "Generate",
    packageName: "@docture/synthetic",
    description:
      "Render labeled documents from the schema with seeded values, a box for every field, and scan, photo, or fax degradation.",
    file: "corpus.ts",
    code: `import {
  defineModel,
  gen,
  validLuhn,
} from "@docture/synthetic";
import {
  digital,
  scan,
  writeCorpus,
} from "@docture/synthetic/node";

const model = defineModel(Bill, {
  fields: {
    accountNumber: gen.luhn("71", 12),
    "usage[].kwh": gen.int(20, 600),
    "usage[].rateCents": gen.int(12, 45),
  },
  constraints: [validLuhn("accountNumber")],
});

await writeCorpus("corpus", {
  model,
  templates: [compact],
  seeds: [1, 2, 3],
  renditions: [
    digital(),
    scan({ severity: 0.4, dpi: 150 }),
  ],
});`,
  },
  {
    id: "evaluate",
    title: "Evaluate",
    packageName: "@docture/eval",
    description: "Score each field against ground truth, slice by rendition or vendor, and fail CI when accuracy drops.",
    file: "eval.ts",
    code: `import { defineEval, exact, number } from "@docture/eval";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";

const result = await runEval({
  dataset: jsonlDataset("corpus/manifest.jsonl", {
    toExpected: (json) => Bill.parse(json),
  }),
  spec: defineEval(Bill, {
    fields: {
      accountNumber: exact(),
      amountDueCents: number(),
    },
  }),
  slices: { rendition: "tags.rendition" },
  experiments: { id: "text-layer", extract: readBill },
});`,
  },
];

export async function Loop() {
  const tabs = await Promise.all(
    loopSteps.map(async ({ code, file, ...step }) => ({
      ...step,
      panel: (
        <CodeWindow file={file} lang="TypeScript">
          {await Code({ code, lang: "ts" })}
        </CodeWindow>
      ),
    })),
  );

  return (
    <Section
      id="loop-heading"
      title="One schema runs the whole loop."
      body="Write the Zod schema once. The same type shapes what you extract, what you generate, and what you score."
    >
      <LoopTabs tabs={tabs} />
    </Section>
  );
}
