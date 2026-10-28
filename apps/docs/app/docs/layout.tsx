import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import Link from "next/link";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const options = baseOptions();

  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...options}
      nav={{
        ...options.nav,
        mode: "top",
        children: (
          <nav key="main-navigation" aria-label="Main navigation" className="docs-navbar-links">
            <Link href="/docs">Documentation</Link>
            <Link href="/docs/reference/api" className="hidden sm:inline-flex">
              API reference
            </Link>
          </nav>
        ),
      }}
      containerProps={{ className: "docs-layout" }}
      sidebar={{ defaultOpenLevel: 0, collapsible: false }}
    >
      {children}
    </DocsLayout>
  );
}
