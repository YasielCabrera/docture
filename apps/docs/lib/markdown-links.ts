import type { Nodes } from "mdast";
import { remark } from "remark";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";

const markdown = remark().use(remarkGfm, { tablePipeAlign: false });

export function rewriteMarkdownLinks(value: string, link: (url: string) => string): string {
  function visit(node: Nodes): void {
    if (node.type === "link" || node.type === "image" || node.type === "definition") node.url = link(node.url);
    if (node.type === "html" && !/^\s*<!--[\s\S]*-->\s*$/.test(node.value)) {
      throw new Error(`Unsupported HTML or MDX in documentation: ${node.value.slice(0, 120)}`);
    }
    if ("children" in node) for (const child of node.children) visit(child);
  }
  const tree = markdown.parse(value);
  visit(tree);
  return markdown.stringify(tree);
}

export function markdownPageUrl(url: string): string {
  const suffix = url.search(/[?#]/);
  const path = (suffix < 0 ? url : url.slice(0, suffix)).replace(/\/$/, "");
  return `${path.endsWith(".md") ? path : `${path}.md`}${suffix < 0 ? "" : url.slice(suffix)}`;
}

export function websiteMarkdownLink(url: string, context: {
  readonly origin: string | undefined;
  readonly pageUrl: string;
  readonly pageUrls: ReadonlySet<string>;
}): string {
  const origin = context.origin ?? "https://docs.invalid";
  const target = new URL(url, new URL(context.pageUrl, origin));
  if (target.origin !== origin) return url;
  const path = target.pathname.replace(/\/$/, "");
  if (context.pageUrls.has(path)) target.pathname = markdownPageUrl(path);
  return context.origin === undefined ? `${target.pathname}${target.search}${target.hash}` : target.href;
}
