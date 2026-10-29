import { notFound } from "next/navigation";
import { LegacyDocRedirect } from "@/components/legacy-doc-redirect";
import { legacyDocs } from "@/lib/docs-migration";
import type { Metadata } from "next";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/notebook/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/components/mdx";
import { PageActions } from "@/components/page-actions";
import { getPageMarkdownUrl, source } from "@/lib/source";

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
    <DocsPage toc={page.data.toc} full={page.data.full}>
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
      </header>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
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

  return { title: page.data.title, description: page.data.description };
}
