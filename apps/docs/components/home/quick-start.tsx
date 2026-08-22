import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CopyCommand } from "./copy-command";

const installCommand = "npm install docture @docture/loader-pdfjs ai @ai-sdk/openai zod";

export function QuickStart() {
  return (
    <section aria-labelledby="quick-start-heading" className="border-b border-fd-border">
      <div className="mx-auto grid min-w-0 max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)] lg:gap-16 lg:py-14">
        <div className="min-w-0">
          <h2
            id="quick-start-heading"
            className="text-2xl leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
          >
            Install docture
          </h2>
          <p className="mt-3 max-w-[38ch] text-base leading-relaxed text-fd-muted-foreground">
            Add the core library, a document loader, your model provider, and Zod.
          </p>
          <Link
            href="/docs/quick-start"
            className="group mt-5 inline-flex items-center gap-2 rounded-control text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            Follow the quick start
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              strokeWidth={1.5}
            />
          </Link>
        </div>

        <div className="min-w-0">
          <CopyCommand command={installCommand} />
        </div>
      </div>
    </section>
  );
}
