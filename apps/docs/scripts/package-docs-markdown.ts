import { posix } from "node:path";
import type { Nodes } from "mdast";
import { remark } from "remark";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";

const markdown = remark().use(remarkGfm).use(remarkHeading, { customId: false, generateToc: false });

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

export function rewriteMarkdownLinks(value: string, link: (url: string) => string): string {
  const tree = markdown.parse(value);
  walk(tree, (node) => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") node.url = link(node.url);
    if (node.type === "html" && !/^\s*<!--[\s\S]*-->\s*$/.test(node.value)) {
      throw new Error(`Unsupported HTML or MDX in packaged documentation: ${node.value.slice(0, 120)}`);
    }
  });
  return markdown.stringify(tree);
}

export function markdownReferences(value: string): { links: string[]; anchors: Set<string> } {
  const links: string[] = [];
  const anchors = new Set<string>();
  walk(markdown.runSync(markdown.parse(value)), (node) => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") links.push(node.url);
    if (node.type === "heading") {
      const id = node.data?.hProperties?.id;
      if (typeof id !== "string") throw new Error("Markdown heading has no generated ID");
      anchors.add(id);
    }
  });
  return { links, anchors };
}

export function isExternalLink(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);
}

export function localLinkTarget(url: string, from: string): { path: string; anchor: string } {
  const parsed = new URL(url, `https://docs.invalid/${from}`);
  const path = decodeURIComponent(parsed.pathname.slice(1));
  const reference = decodeURIComponent(url.split(/[?#]/, 1)[0] ?? "");
  const expected = reference === "" ? from : posix.normalize(posix.join(posix.dirname(from), reference));
  if (parsed.origin !== "https://docs.invalid" || path !== expected || path === ".." || path.startsWith("../") || path.includes("\\")) throw new Error(`Invalid local documentation link: ${url}`);
  return { path, anchor: decodeURIComponent(parsed.hash.slice(1)) };
}

export function validateDocumentationLinks(files: ReadonlyMap<string, string>): void {
  const parsed = new Map([...files].filter(([path]) => /\.(?:md|txt)$/.test(path)).map(([path, value]) => [path, markdownReferences(value)]));
  for (const [from, references] of parsed) {
    for (const url of references.links) {
      if (isExternalLink(url)) continue;
      if (url.startsWith("/")) throw new Error(`${from}: documentation link must be relative: ${url}`);
      const target = localLinkTarget(url, from);
      if (!files.has(target.path)) throw new Error(`${from}: missing local documentation target ${url}`);
      if (target.anchor && !parsed.get(target.path)?.anchors.has(target.anchor)) throw new Error(`${from}: missing documentation anchor ${url}`);
    }
  }
}

export function offlineLink(options: { url: string; from: string; routes: ReadonlyMap<string, string>; revision: string | null }): string {
  const { url, from, routes, revision } = options;
  if (isExternalLink(url)) {
    return revision === null ? url : url.replace(/^(https:\/\/github\.com\/YasielCabrera\/docture\/(?:blob|tree)\/)main(?=\/|$)/, `$1${revision}`);
  }
  if (url.startsWith("#")) return url;
  const suffixIndex = url.search(/[?#]/);
  const path = suffixIndex < 0 ? url : url.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : url.slice(suffixIndex);
  const destination = routes.get(path) ?? (!path.startsWith("/") ? posix.normalize(posix.join(posix.dirname(from), path.replace(/\.mdx$/, ".md"))) : undefined);
  if (destination === undefined) throw new Error(`${from}: no packaged documentation target for ${url}`);
  return `${posix.relative(posix.dirname(from), destination) || posix.basename(destination)}${suffix}`;
}
