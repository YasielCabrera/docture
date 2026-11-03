import { llmsArea } from "@/lib/llms-index";
import { absoluteUrl, docsRelease } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [...new Set(source.getPages().flatMap((page) => page.slugs.length > 1 ? [page.slugs[0]] : []))].map((area) => ({ area: `${area}.txt` }));
}

export async function GET(_request: Request, context: { params: Promise<{ area: string }> }) {
  const area = (await context.params).area.replace(/\.txt$/, "");
  const pages = new Map(source.getPages().map((page) => [page.url, page.data]));
  const text = llmsArea({ tree: source.getPageTree(), page: (url) => pages.get(url), link: absoluteUrl, release: docsRelease }, area);
  return new Response(text ?? "Not found", {
    status: text === undefined ? 404 : 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
