import { llmsIndex } from "@/lib/llms-index";
import { absoluteUrl, docsRelease } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export function GET() {
  const pages = new Map(source.getPages().map((page) => [page.url, page.data]));
  const index = llmsIndex({ tree: source.getPageTree(), page: (url) => pages.get(url), link: absoluteUrl, release: docsRelease });
  return new Response(index, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
