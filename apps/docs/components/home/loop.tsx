import { readExampleSource } from "@/lib/example-source";
import { Code } from "./code";
import { LoopTabs } from "./loop-tabs";
import { ArrowLink, CodeWindow, Section } from "./section";

interface LoopStep {
  readonly id: string;
  readonly title: string;
  readonly packageName: string;
  readonly description: string;
  /** A type-checked file under `examples/home`, shown in full. */
  readonly file: string;
}

const loopSteps: readonly LoopStep[] = [
  {
    id: "extract",
    title: "Extract",
    packageName: "docture",
    description:
      "Load a PDF, scan, or email. Run deterministic parsers first, then any AI SDK model, and get data validated against the schema.",
    file: "extract.ts",
  },
  {
    id: "generate",
    title: "Generate",
    packageName: "@docture/synthetic",
    description:
      "Render labeled documents from the schema with seeded values, a box for every field, and scan, photo, or fax degradation.",
    file: "corpus.ts",
  },
  {
    id: "evaluate",
    title: "Evaluate",
    packageName: "@docture/eval",
    description: "Score each field against ground truth, slice by rendition or vendor, and fail CI when accuracy drops.",
    file: "eval.ts",
  },
];

export async function Loop() {
  const tabs = await Promise.all(
    loopSteps.map(async ({ file, ...step }) => ({
      ...step,
      panel: (
        <CodeWindow file={file} lang="TypeScript">
          {await Code({ code: await readExampleSource(`home/${file}`), lang: "ts" })}
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
      <div className="mt-5 flex justify-end">
        <ArrowLink href="/docs/getting-started/build-the-loop">Build the loop step by step</ArrowLink>
      </div>
    </Section>
  );
}
