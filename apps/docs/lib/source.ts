import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { PAGE_TYPES } from "../scripts/page-rules";
import { toAgentMarkdown } from "./agent-markdown";
import { expandSourceExamples } from "./example-source";
import { absoluteUrl, docsRelease } from "./site";
import { docsRoute } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({ type: z.enum(PAGE_TYPES) }),
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
  const processed = toAgentMarkdown(await expandSourceExamples(await page.data.getText("processed")));
  const header = [`# ${page.data.title}`, "", `> ${page.data.description ?? ""}`, "", `Source: ${absoluteUrl(page.url)}. Documents docture ${docsRelease}.`];
  return `${header.join("\n")}\n\n${processed}`;
}
