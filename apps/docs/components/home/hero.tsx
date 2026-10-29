import { Code } from "./code";
import { CopyCommand } from "./copy-command";
import { DocumentFigure, FieldBox } from "./document-figure";
import { CodeWindow, QuickStartLink } from "./section";
import { heroBoxes, heroImage, heroResult } from "@/lib/hero-document";

const result = `{
  invoiceNumber: ${JSON.stringify(heroResult.invoiceNumber)},
  lineItems: [ /* ${String(heroResult.lineItemCount)} rows */ ],
  total: ${String(heroResult.total)},
}`;

// The total sits at the bottom right of the page; a tag above it would cover the VAT
// line. Below sm the frame is too short to fit a tag under it, so it goes above there.
const tagBelow: ReadonlySet<string> = new Set(["total"]);

const reveal = "motion-safe:animate-rise";

export async function Hero() {
  // Four short lines that always fit; a scroll container here only shows a scrollbar
  // when sub-pixel rounding makes the fitted width a fraction short.
  const resultCode = await Code({ code: result, lang: "ts", className: "overflow-x-visible!" });

  return (
    <section className="border-b border-fd-border">
      <div className="site-container grid gap-12 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:pt-18 lg:pb-20">
        <div className="flex min-w-0 flex-col justify-center gap-[1.375rem]">
          <p className={`font-mono text-sm text-brand ${reveal}`}>Document structure for TypeScript</p>
          <h1
            className={`text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance lg:text-[3.125rem] ${reveal} [animation-delay:70ms]`}
          >
            Structure any document. Prove it is right.
          </h1>
          <p className={`max-w-[44ch] text-lg leading-[1.6] text-fd-muted-foreground ${reveal} [animation-delay:140ms]`}>
            Turn PDFs, scans, and email into schema-typed data. Measure it with generated test documents and
            field-level evals.
          </p>
          <div className={`flex flex-wrap gap-3 ${reveal} [animation-delay:210ms]`}>
            <QuickStartLink />
            <CopyCommand command="pnpm add docture zod" />
          </div>
        </div>

        <div className={`relative min-w-0 pt-2 lg:pt-7 lg:pb-28 ${reveal} [animation-delay:140ms]`}>
          <DocumentFigure
            image={heroImage}
            eager
            sizes="(min-width: 1280px) 35rem, (min-width: 1024px) 46vw, 92vw"
            className="ms-auto w-[92%] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.3)] dark:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.8)]"
          >
            {heroBoxes.map((box) => (
              <FieldBox key={box.field} box={box}>
                <span
                  className={`absolute rounded px-1.5 py-1 font-mono text-[0.6875rem] leading-none font-medium whitespace-nowrap bg-brand-solid text-brand-on-solid ${
                    tagBelow.has(box.field) ? "-right-[1.5px] bottom-[calc(100%+4px)] sm:top-[calc(100%+4px)] sm:bottom-auto" : "-left-[1.5px] bottom-[calc(100%+4px)]"
                  }`}
                >
                  {box.field}
                  <span className="ms-1 opacity-75">{box.type}</span>
                </span>
              </FieldBox>
            ))}
          </DocumentFigure>
          <CodeWindow
            file="result.data"
            lang="Invoice"
            className="relative -mt-4 w-fit max-w-full sm:-mt-12 lg:absolute lg:bottom-0 lg:left-0 lg:mt-0"
          >
            {resultCode}
          </CodeWindow>
        </div>
      </div>
    </section>
  );
}
