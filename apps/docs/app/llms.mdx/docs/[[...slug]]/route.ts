import { getLLMText, source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: [...page.slugs, "content.md"] }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug?: string[] }> },
) {
  const { slug = [] } = await context.params;
  if (slug.at(-1) !== "content.md") return new Response("Not found", { status: 404 });
  const page = source.getPage(slug.slice(0, -1));
  if (page === undefined) return new Response("Not found", { status: 404 });
  return new Response(await getLLMText(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
