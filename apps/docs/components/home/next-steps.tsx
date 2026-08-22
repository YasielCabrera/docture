import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Where to go, as rows rather than another card grid. Four destinations, so a
 * divided list is the right size for it.
 */
const steps = [
  {
    title: "How it works",
    body: "The pipeline, step by step, with the diagrams.",
    href: "/docs/how-it-works",
  },
  {
    title: "Without a model",
    body: "Deterministic extraction. No API calls, no key, no cost.",
    href: "/docs/guides/without-a-model",
  },
  {
    title: "Scanned documents",
    body: "OCR it, or show it to a vision model. Both are one import.",
    href: "/docs/guides/scanned-documents",
  },
  {
    title: "Measuring accuracy",
    body: "Field-level scoring, for a test or a CI gate.",
    href: "/docs/guides/measuring-accuracy",
  },
];

export function NextSteps() {
  return (
    <section aria-labelledby="guides-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <h2
          id="guides-heading"
          className="text-3xl leading-[1.12] font-semibold tracking-[-0.025em] sm:text-4xl"
        >
          Choose a guide
        </h2>
        <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-fd-muted-foreground">
          Start with the path closest to the documents you need to process.
        </p>

        <ul className="mt-10 border-t border-fd-border">
          {steps.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
                className="group flex flex-col gap-1 border-b border-fd-border py-6 transition-[padding] duration-200 ease-out-quint hover:ps-3 sm:flex-row sm:items-baseline sm:gap-8"
              >
                <span className="flex min-w-0 items-center gap-2 text-lg font-medium sm:w-64 sm:shrink-0">
                  {step.title}
                  <ArrowRight
                    className="size-4 shrink-0 -translate-x-1 text-brand opacity-0 transition-all duration-200 ease-out-quint group-hover:translate-x-0 group-hover:opacity-100"
                    strokeWidth={1.5}
                  />
                </span>
                <span className="text-fd-muted-foreground">{step.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
