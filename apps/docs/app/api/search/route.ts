import { createDocumentationSearch, searchBreadcrumbs } from "@/lib/search";
import { source } from "@/lib/source";

export const { GET } = createDocumentationSearch(source.getPages().map((page) => ({
  url: page.url,
  title: page.data.title,
  description: page.data.description,
  tasks: page.data.tasks,
  breadcrumbs: searchBreadcrumbs(source.getPageTree(page.locale), page.url),
  structuredData: page.data.structuredData,
})));
