import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!isMarkdownPreferred(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path === "/docs" ? "/llms.mdx/docs/content.md" : `/llms.mdx${path}/content.md`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/docs", "/docs/:path((?!.*\\.md$).*)"] };
