import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Code } from "./code";
import { appName } from "@/lib/shared";

const example = `import { Extractor, LLM, contract } from "docture";
import { DocumentLoaderPdfJs } from "@docture/loader-pdfjs";
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

const result = await extractor.extract("invoice.pdf", Invoice);
result.data.total; // number`;

export async function Hero() {
  const code = await Code({ code: example, lang: "ts" });

  return (
    <section className="relative overflow-hidden border-b border-fd-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.055] dark:opacity-[0.1]"
        style={{
          background:
            "radial-gradient(70rem 40rem at 78% 18%, var(--color-brand), transparent 60%)",
        }}
      />

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 lg:min-h-[calc(100dvh-3.5rem)] lg:grid-cols-12 lg:gap-14 lg:py-16">
        <div className="flex flex-col justify-center lg:col-span-6">
          <p className="font-mono text-sm text-brand">
            {appName} for TypeScript
          </p>

          <h1 className="mt-4 max-w-[15ch] text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[3.35rem]">
            Typed data from any document.
          </h1>

          <p className="mt-5 max-w-[44ch] text-lg leading-relaxed text-fd-muted-foreground">
            Choose the loader and strategy. Get validated data inferred from your schema.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs/quick-start"
              className="group inline-flex items-center gap-2 rounded-control bg-brand-solid px-5 py-2.5 text-sm font-medium whitespace-nowrap text-brand-on-solid transition-transform duration-200 ease-out-quint hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              Quick start
              <ArrowRight
                className="size-4 transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5"
                strokeWidth={1.5}
              />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center rounded-control border border-fd-border px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 hover:bg-fd-accent active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              Browse docs
            </Link>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-6 lg:col-start-7">
          <div className="min-w-0 overflow-hidden rounded-surface border border-fd-border bg-fd-card">
            <div className="flex items-center justify-between border-b border-fd-border bg-fd-muted/35 px-5 py-3 text-xs text-fd-muted-foreground">
              <span className="font-medium text-fd-foreground">extract.ts</span>
              <span className="font-mono">TypeScript</span>
            </div>
            {code}
          </div>
        </div>
      </div>
    </section>
  );
}
