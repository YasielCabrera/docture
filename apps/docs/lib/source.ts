import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { PAGE_TYPES } from "../scripts/page-rules";
import { toAgentMarkdown, transformMarkdownHtml } from "./agent-markdown";
import { expandSourceExamples } from "./example-source";
import { apiSymbolsMarkdown } from "./api-symbol-markdown";
import symbols from "../public/api-symbols.json";
import { absoluteUrl, docsRelease, docsRevision } from "./site";
import { docsRoute } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({ type: z.enum(PAGE_TYPES), tasks: z.array(z.string()).default([]) }),
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]): string {
  return `${page.url}.md`;
}

export async function getLLMText(page: (typeof source)["$inferPage"]): Promise<string> {
  return getPageMarkdown(page, { release: docsRelease, revision: docsRevision, sourceUrl: absoluteUrl });
}

export async function getPageMarkdown(page: (typeof source)["$inferPage"], context: {
  readonly release: string;
  readonly revision: string;
  readonly sourceUrl: (url: string) => string;
}): Promise<string> {
  const expanded = await transformMarkdownHtml(await expandSourceExamples(await page.data.getText("processed")),
    (prose) => prose.replace(/<ApiIndex\s*\/>/g, () => apiSymbolsMarkdown(symbols)));
  const processed = toAgentMarkdown(expanded);
  const header = [`# ${page.data.title}`, "", `> ${page.data.description ?? ""}`, "", `Source: ${context.sourceUrl(page.url)}. Documents docture ${context.release}.`, `Page type: ${page.data.type}. Source revision: ${context.revision}.`];
  return `${header.join("\n")}\n\n${processed}`;
}
