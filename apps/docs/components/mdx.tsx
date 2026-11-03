import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "@/components/mdx/mermaid";
import { SourceExample } from "@/components/mdx/source-example";
import { CodeExample } from "@/components/mdx/code-example";
import { ApiIndex } from "@/components/api-index";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    pre: CodeExample,
    // `remarkMermaidMarkdown` rewrites ```mermaid fences to <Mermaid />, so this is what
    // makes a plain markdown code fence render as a diagram.
    Mermaid,
    SourceExample,
    ApiIndex,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
