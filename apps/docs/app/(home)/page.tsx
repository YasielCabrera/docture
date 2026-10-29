import type { Metadata } from "next";
import { Engines } from "@/components/home/engines";
import { Evidence } from "@/components/home/evidence";
import { Hero } from "@/components/home/hero";
import { Loop } from "@/components/home/loop";
import { QuickStartLink } from "@/components/home/section";
import { appName, appTagline } from "@/lib/shared";

export const metadata: Metadata = {
  title: { absolute: `${appName} - ${appTagline}` },
  description:
    "Extract schema-typed data from PDFs, scans, and email in TypeScript, then measure it with generated test documents and field-level evals.",
};

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <Hero />
      <Loop />
      <Evidence />
      <Engines />
      <section aria-labelledby="start-heading">
        <div className="site-container flex flex-col items-start gap-5 py-14 lg:flex-row lg:items-center lg:justify-between lg:py-24">
          <h2 id="start-heading" className="text-[1.875rem] leading-[1.12] font-semibold tracking-[-0.025em] lg:text-4xl">
            Start with one PDF.
          </h2>
          <QuickStartLink />
        </div>
      </section>
    </div>
  );
}
