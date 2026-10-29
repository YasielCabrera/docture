import Link from "next/link";
import { ArrowRight } from "lucide-react";

const features = [
  {
    title: "Schema-typed results",
    body: "The shape of result.data is inferred from your schema and validated before it reaches your code.",
    href: "/docs/extraction/schemas",
  },
  {
    title: "Loaders you choose",
    body: "Read PDF text, run Tesseract or PaddleOCR, or render pages for a vision model.",
    href: "/docs/integrations/loaders",
  },
  {
    title: "Strategies in order",
    body: "Try deterministic parsing first, then fall back to any AI SDK model when the document needs it.",
    href: "/docs/extraction/strategies",
  },
  {
    title: "Classification and bundles",
    body: "Identify document kinds, split multi-document files, and keep the result narrowed to the right contract.",
    href: "/docs/extraction/splitting",
  },
  {
    title: "Observable runs",
    body: "Inspect every attempt, typed error codes, validation issues, token use, and wall time.",
    href: "/docs/resources/errors",
  },
] as const;

export function Features() {
  return (
    <section aria-labelledby="features-heading" className="border-b border-fd-border">
      <div className="site-container grid gap-12 py-16 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)] lg:gap-20 lg:py-24">
        <div>
          <h2
            id="features-heading"
            className="max-w-[13ch] text-3xl leading-[1.12] font-semibold tracking-[-0.025em] text-balance sm:text-4xl"
          >
            What the library handles
          </h2>
          <p className="mt-4 max-w-[36ch] text-base leading-relaxed text-fd-muted-foreground">
            Pick the loader and extraction strategy you need. Each part can be replaced
            independently.
          </p>
        </div>

        <dl className="border-t border-fd-border">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="grid gap-2 border-b border-fd-border py-5 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start sm:gap-6"
            >
              <dt className="font-medium text-fd-foreground sm:col-start-1 sm:row-start-1">
                <Link
                  href={feature.href}
                  className="rounded-control underline decoration-fd-border underline-offset-4 transition-colors duration-200 hover:text-brand hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                >
                  {feature.title}
                </Link>
              </dt>
              <dd className="max-w-[52ch] text-sm leading-relaxed text-fd-muted-foreground sm:col-start-2 sm:row-start-1">
                {feature.body}
              </dd>
              <span
                aria-hidden
                className="row-start-1 ms-auto hidden rounded-control p-1 text-brand sm:col-start-3 sm:inline-flex"
              >
                <ArrowRight
                  className="size-4"
                  strokeWidth={1.5}
                />
              </span>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
