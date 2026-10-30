import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { SidebarSection } from "@/components/sidebar-section";
import { DocsHeader } from "@/components/docs-header";
import { primaryNavigation } from "@/lib/shared";
import { docsRelease } from "@/lib/site";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const options = baseOptions();

  return (
    <DocsLayout
      tree={source.getPageTree()}
      tabs={false}
      {...options}
      nav={{
        ...options.nav,
        mode: "top",
      }}
      slots={{ header: DocsHeader }}
      containerProps={{ className: "docs-layout" }}
      sidebar={{
        defaultOpenLevel: 0,
        components: { Folder: SidebarSection },
        collapsible: false,
        banner: (
          <nav key="docs-main-navigation" aria-label="Site sections" className="flex flex-col gap-1 md:hidden">
            {primaryNavigation.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-control px-2 py-2 text-sm hover:bg-fd-accent">
                {link.label}
              </Link>
            ))}
          </nav>
        ),
        footer: (
          <p data-docs-release="" className="px-2 pb-2 text-xs text-fd-muted-foreground">
            Docs for docture {docsRelease}.{" "}
            <Link href="/docs/resources/changelog" className="underline underline-offset-2 hover:text-fd-foreground">
              Changelog
            </Link>
          </p>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
