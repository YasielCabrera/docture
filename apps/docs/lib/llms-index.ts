import type { Folder, Node, Root } from "fumadocs-core/page-tree";

export interface IndexedPage {
  readonly title: string;
  readonly description?: string;
}

export interface LlmsIndexOptions {
  readonly tree: Root;
  readonly page: (url: string) => IndexedPage | undefined;
  readonly link: (url: string) => string;
  readonly release: string;
}

function folderUrls(folder: Folder): string[] {
  return [...folder.index === undefined ? [] : [folder.index.url], ...folder.children.flatMap(nodeUrls)];
}

function nodeUrls(node: Node): string[] {
  if (node.type === "page") return [node.url];
  if (node.type === "folder") return folderUrls(node);
  return [];
}

export function llmsIndex({ tree, page, link, release }: LlmsIndexOptions): string {
  const entry = (url: string): string[] => {
    const data = page(url);
    if (data === undefined) return [];
    return [`- [${data.title}](${link(`${url}.md`)})${data.description ? `: ${data.description}` : ""}`];
  };
  const overview = tree.children.filter((node) => node.type === "page").flatMap(nodeUrls);
  const sections = tree.children.flatMap((node) => node.type === "folder" ? [{ title: String(node.name), area: node.index?.url.split("/")[2], urls: folderUrls(node) }] : []);
  return [
    "# docture",
    "",
    `> Typed data extraction, document conversion, evaluation, and synthetic test documents for TypeScript. These docs cover docture, @docture/cli, @docture/eval, and @docture/synthetic ${release}.`,
    "",
    `Every page is listed below as Markdown. Add \`.md\` to any documentation URL for the same Markdown, or fetch [llms-full.txt](${link("/llms-full.txt")}) for every page in one file. Each section below also links its own full file, which is smaller.`,
    "",
    "## Overview",
    "",
    ...overview.flatMap(entry),
    ...sections.flatMap(({ title, area, urls }) => [
      "",
      `## ${title}`,
      "",
      ...area === undefined ? [] : [`Every ${title} page in one file: [${area}.txt](${link(`/llms-full/${area}.txt`)})`, ""],
      ...urls.flatMap(entry),
    ]),
    "",
  ].join("\n");
}
