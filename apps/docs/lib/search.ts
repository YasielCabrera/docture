import { createSearchAPI, type Index } from "fumadocs-core/search/server";
import { createContentHighlighter } from "fumadocs-core/search";
import type { StructuredData } from "fumadocs-core/mdx-plugins";
import { findPath, type Root } from "fumadocs-core/page-tree";

export interface SearchPage {
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly tasks: readonly string[];
  readonly breadcrumbs?: readonly string[];
  readonly structuredData: StructuredData;
}

export function searchBreadcrumbs(tree: Root, url: string): string[] | undefined {
  const path = findPath(tree.children, (node) => node.type === "page" && node.url === url);
  if (path === null) return undefined;
  return [tree.name, ...path.slice(0, -1).map((node) => node.name)]
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export function documentationIndexes(pages: readonly SearchPage[]): Index[] {
  return pages.flatMap((page) => [page.title, ...page.tasks].map((title) => ({
    title,
    description: page.description,
    content: "",
    url: page.url,
    breadcrumbs: page.breadcrumbs?.slice(),
  })));
}

export function createDocumentationSearch(pages: readonly SearchPage[]) {
  const titles = new Map(pages.map((page) => [page.url, page.title]));
  const complete = createSearchAPI("simple", {
    indexes: pages.map((page) => ({
      title: [page.title, ...page.tasks].join(" ").toLowerCase(),
      description: page.description?.toLowerCase(),
      content: "",
      url: page.url,
      breadcrumbs: page.breadcrumbs?.slice(),
    })),
    search: { properties: ["title", "description"], threshold: 0, exact: true, boost: { title: 3, description: 1 } },
  });
  const navigation = createSearchAPI("simple", {
    indexes: documentationIndexes(pages),
    search: { properties: ["title", "description"], boost: { title: 3, description: 1 } },
  });
  const details = createSearchAPI("advanced", {
    indexes: pages.map((page) => ({ ...page, breadcrumbs: page.breadcrumbs?.slice(), id: page.url })),
  });
  async function search(query: string) {
    const navigationResults = complete.search(query.toLowerCase()).then((results) => results.length > 0 ? results
      : navigation.search(query.replace(/\b(?:a|an|and|are|as|at|be|by|for|from|in|into|is|it|my|of|on|or|out|that|the|their|this|to|with|your)\b/gi, " ")));
    const [preferred, matches] = await Promise.all([navigationResults, details.search(query)]);
    const highlighter = createContentHighlighter(query);
    const labelled = preferred.map((result) => ({ ...result, content: highlighter.highlightMarkdown(titles.get(result.url) ?? result.content) }));
    const children = new Map<string, typeof matches>();
    for (const match of matches) {
      if (match.type === "page") continue;
      const fragment = match.url.indexOf("#");
      const pageUrl = fragment === -1 ? match.url : match.url.slice(0, fragment);
      const group = children.get(pageUrl) ?? [];
      group.push(match);
      children.set(pageUrl, group);
    }
    const seen = new Set<string>();
    return [...labelled, ...matches.filter((result) => result.type === "page")].flatMap((page) => {
      if (seen.has(page.url)) return [];
      seen.add(page.url);
      return [page, ...(children.get(page.url) ?? [])];
    }).slice(0, 60);
  }
  return {
    search,
    async GET(request: Request) {
      return Response.json(await search(new URL(request.url).searchParams.get("query") ?? ""));
    },
  };
}
