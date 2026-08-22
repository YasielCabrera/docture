import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Mermaid } from "@/components/mdx/mermaid";
import { SourceExample } from "@/components/mdx/source-example";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // `remarkMdxMermaid` rewrites ```mermaid fences to <Mermaid />, so this is what
    // makes a plain markdown code fence render as a diagram.
    Mermaid,
    SourceExample,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
