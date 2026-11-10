import { notFound } from "next/navigation";
import { LegacyDocRedirect } from "@/components/legacy-doc-redirect";
import { legacyDocs } from "@/lib/docs-migration";
import type { Metadata } from "next";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
} from "fumadocs-ui/layouts/notebook/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/components/mdx";
import { PageActions } from "@/components/page-actions";
import { PageTOCPopover } from "@/components/page-toc";
import { gitConfig, repositoryUrl } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";
import { docsRelease } from "@/lib/site";
import Link from "next/link";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    const entry = legacyDocs.get(`/docs/${(params.slug ?? []).join("/")}`);
    if (entry === undefined) notFound();
    return <LegacyDocRedirect entry={entry} />;
  }

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      role="main"
      tabIndex={-1}
      tableOfContent={{ container: { role: "navigation", "aria-label": "Page contents" } }}
      tableOfContentPopover={{ component: <PageTOCPopover /> }}
    >
      <header className="docs-page-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <DocsTitle className="text-3xl tracking-tight sm:text-4xl">
            {page.data.title}
          </DocsTitle>
          <PageActions markdownUrl={getPageMarkdownUrl(page)} />
        </div>
        <DocsDescription className="mb-0 mt-4 text-base leading-relaxed sm:text-lg">
          {page.data.description}
        </DocsDescription>
        <p className="mt-3 text-sm text-fd-muted-foreground" aria-label="Documentation version">
          Documents docture {docsRelease}.{" "}
          <Link href="/docs/getting-started/ai-agents#read-the-installed-documentation" className="underline underline-offset-4">
            Match your installed version
          </Link>
        </p>
      </header>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
      <EditOnGitHub href={`${repositoryUrl}/blob/${gitConfig.branch}/apps/docs/content/docs/${page.path}`} />
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return [...source.generateParams(), ...Array.from(legacyDocs.keys(), (route) => ({ slug: route.slice("/docs/".length).split("/") }))];
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    const entry = legacyDocs.get(`/docs/${(params.slug ?? []).join("/")}`);
    if (entry === undefined) notFound();
    return { title: "Documentation moved", robots: { index: false, follow: true }, alternates: { canonical: entry.to } };
  }

  return { title: page.data.title, description: page.data.description, alternates: { canonical: page.url, types: { "text/markdown": getPageMarkdownUrl(page) } } };
}
