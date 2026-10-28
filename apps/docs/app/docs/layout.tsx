import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { DocsHeader } from "@/components/docs-header";
import { primaryNavigation } from "@/lib/shared";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const options = baseOptions();

  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...options}
      nav={{
        ...options.nav,
        mode: "top",
      }}
      slots={{ header: DocsHeader }}
      containerProps={{ className: "docs-layout" }}
      sidebar={{
        defaultOpenLevel: 0,
        collapsible: false,
        banner: (
          <nav aria-label="Main navigation" className="flex flex-col gap-1 md:hidden">
            {primaryNavigation.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-control px-2 py-2 text-sm hover:bg-fd-accent">
                {link.label}
              </Link>
            ))}
          </nav>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
