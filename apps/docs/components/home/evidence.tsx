import { DocumentFigure, FieldBox } from "./document-figure";
import { ArrowLink, Section } from "./section";
import { evalEvidence } from "@/lib/eval-evidence";

export function Evidence() {
  return (
    <Section
      id="evidence-heading"
      title="The eval finds what a demo hides."
      body="One generated bill, two renditions, the same text-layer extractor. The digital PDF scores perfectly. The scan scores zero, because it has no text layer to read."
      className="bg-fd-card"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {evalEvidence.renditions.map((rendition) => (
          <div
            key={rendition.src}
            className="flex min-w-0 flex-col gap-4 rounded-surface border border-fd-border bg-fd-background p-5"
          >
            <DocumentFigure image={rendition} sizes="(min-width: 1280px) 37rem, (min-width: 1024px) 46vw, 92vw">
              {rendition.boxes.map((box) => (
                <FieldBox key={box.path} box={box} />
              ))}
            </DocumentFigure>
            <div className="flex items-end justify-between gap-4">
              <p className="text-sm text-fd-muted-foreground">{rendition.label}</p>
              <p
                className={`text-[2.75rem] leading-none font-semibold tracking-[-0.04em] tabular-nums ${
                  rendition.f1 < 1 ? "text-brand" : ""
                }`}
              >
                <span className="me-2 text-sm font-medium tracking-normal text-fd-muted-foreground">F1</span>
                {rendition.f1.toFixed(1)}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-4 text-[0.8125rem] text-fd-muted-foreground">
        <span className="font-mono">
          Output of examples/synthetic-corpus.ts over {String(evalEvidence.caseCount)} generated cases
        </span>
        <ArrowLink href="/docs/evaluation/quick-start">Read the evaluation guide</ArrowLink>
      </div>
    </Section>
  );
}
