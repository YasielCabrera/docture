import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function Section({
  id,
  title,
  body,
  className = "",
  children,
}: {
  id: string;
  title: string;
  body: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`border-b border-fd-border ${className}`}>
      <div className="site-container py-14 lg:py-24">
        <div className="mb-10 flex flex-col gap-3">
          <h2 id={id} className="text-[1.875rem] leading-[1.12] font-semibold tracking-[-0.025em] text-balance lg:text-4xl">
            {title}
          </h2>
          <p className="max-w-[58ch] text-[0.9375rem] leading-[1.65] text-fd-muted-foreground">{body}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export function CodeWindow({
  file,
  lang,
  className = "",
  children,
}: {
  file: string;
  lang: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-surface border border-fd-border bg-fd-card ${className}`}>
      <div className="flex items-center justify-between gap-4 border-b border-fd-border bg-fd-muted/45 px-4 py-2.5 text-xs text-fd-muted-foreground">
        <span className="font-medium text-fd-foreground">{file}</span>
        <span className="font-mono">{lang}</span>
      </div>
      {children}
    </div>
  );
}

export function QuickStartLink() {
  return (
    <Link
      href="/docs/extraction/quick-start"
      className="group inline-flex h-[2.625rem] items-center gap-2 rounded-control bg-brand-solid px-[1.125rem] text-sm font-medium whitespace-nowrap text-brand-on-solid transition-transform duration-200 ease-out-quint hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
    >
      Quick start
      <ArrowRight
        className="size-4 transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5"
        strokeWidth={1.5}
      />
    </Link>
  );
}

export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
    >
      {children}
      <ArrowRight
        className="size-4 transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5"
        strokeWidth={1.5}
      />
    </Link>
  );
}
