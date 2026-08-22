import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { docsContentRoute, docsRoute } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]): string {
  const segments = [...page.slugs, "content.md"];
  return "/" + [page.locale, ...docsContentRoute.split("/"), ...segments].filter(Boolean).join("/");
}

export async function getLLMText(page: (typeof source)["$inferPage"]): Promise<string> {
  const processed = await page.data.getText("processed");
  return `# ${page.data.title} (${page.url})\n\n${processed}`;
}
