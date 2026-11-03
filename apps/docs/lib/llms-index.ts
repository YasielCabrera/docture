import type { Folder, Node, Root } from "fumadocs-core/page-tree";

export interface IndexedPage {
  readonly title: string;
  readonly description?: string;
  readonly type?: string;
  readonly tasks?: readonly string[];
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
    `Start with the [task index](${link("/llms-tasks.txt")}) for a goal, or the [symbol index](${link("/api-symbols.json")}) for an API name. Prefer a scoped area index and fetch individual Markdown pages as needed.`,
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
      ...area === undefined ? [] : ["", `Discover this area's pages: [${area} index](${link(`/llms/${area}.txt`)})`],
    ]),
    "",
  ].join("\n");
}

export function llmsTasks({ tree, page, link, release }: LlmsIndexOptions): string {
  const urls = tree.children.flatMap(nodeUrls);
  const tasks = urls.flatMap((url) => {
    const data = page(url);
    if (data === undefined || (data.type !== "tutorial" && !data.tasks?.length)) return [];
    return [`- [${data.title}](${link(`${url}.md`)}): ${data.tasks?.join("; ") || data.description || "Follow the tutorial."}`];
  });
  const areas = tree.children.flatMap((node) => node.type === "folder" && node.index !== undefined
    ? [`- [${String(node.name)}](${link(`/llms/${node.index.url.split("/")[2]}.txt`)})`]
    : []);
  return ["# docture tasks", "", `> Task guides for docture ${release}.`, "", "Read the installed package's AGENTS.md first. Use a task guide for complete prerequisites and expected output. Fetch only the references the task needs.", "", "## Tasks", "", ...tasks, "", "## Area indexes", "", ...areas, "", `Look up exact APIs in [api-symbols.json](${link("/api-symbols.json")}). The [complete page index](${link("/llms.txt")}) and [bulk export](${link("/llms-full.txt")}) remain available.`, ""].join("\n");
}

export function llmsArea(options: LlmsIndexOptions, area: string): string | undefined {
  const folder = options.tree.children.find((node): node is Folder => node.type === "folder" && node.index?.url === `/docs/${area}`);
  if (folder === undefined) return undefined;
  const entries = folderUrls(folder).flatMap((url) => {
    const page = options.page(url);
    return page === undefined ? [] : [`- [${page.title}](${options.link(`${url}.md`)})${page.description ? `: ${page.description}` : ""}`];
  });
  return [`# docture ${String(folder.name)}`, "", `> Markdown page index for docture ${options.release}.`, "", "Fetch the relevant guide first, then its linked references.", "", ...entries, "", `Optional bulk export: [${area}.txt](${options.link(`/llms-full/${area}.txt`)})`, ""].join("\n");
}
