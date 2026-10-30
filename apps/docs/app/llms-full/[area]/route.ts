import { getLLMText, source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [...new Set(source.getPages().flatMap((page) => page.slugs.length > 1 ? [page.slugs[0]] : []))].map((area) => ({ area: `${area}.txt` }));
}

export async function GET(_request: Request, context: { params: Promise<{ area: string }> }) {
  const area = (await context.params).area.replace(/\.txt$/, "");
  const pages = source.getPages().filter((page) => page.slugs[0] === area);
  if (pages.length === 0) return new Response("Not found", { status: 404 });
  return new Response((await Promise.all(pages.map(getLLMText))).join("\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
