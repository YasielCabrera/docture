import { describe, expect, it } from "vitest";
import type { Root } from "fumadocs-core/page-tree";
import type { Root as MarkdownRoot } from "mdast";
import { defaultStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import { remarkMermaidMarkdown } from "../lib/mermaid-markdown";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { unified } from "unified";
import { toAgentMarkdown, transformMarkdownHtml } from "../lib/agent-markdown";
import { llmsIndex } from "../lib/llms-index";

describe("agent Markdown", () => {
  it("publishes diagram code with its accessible description", () => {
    const chart = 'flowchart LR\n  accTitle: A "quoted" title\n  accDescr: Read "PDFs" & images with &copy; and &#x22; literals.\n  A["PDF & image"] --> B["Fields"]';
    const tree: MarkdownRoot = { type: "root", children: [{ type: "code", lang: "mermaid", value: chart }] };
    const processor = unified();
    processor.use(remarkMdxMermaid).use(remarkMermaidMarkdown);
    processor.runSync(tree);
    const processed = defaultStringifier({ filterElement: () => true }).call(processor, tree, undefined);
    expect(toAgentMarkdown(processed)).toBe(`A "quoted" title. Read "PDFs" & images with &copy; and &#x22; literals.\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n`);
    expect(tree.children[0]).toMatchObject({ type: "mdxJsxFlowElement", name: "Mermaid", attributes: [{ name: "chart", value: chart }] });
  });

  it("keeps embedded code delimiters inside a complete exported diagram fence", () => {
    const chart = 'flowchart LR\n  accDescr: A label can mention ```code```.\n  A[PDF] --> B[Fields]';
    const tree: MarkdownRoot = { type: "root", children: [{ type: "code", lang: "mermaid", value: chart }] };
    const processor = unified();
    processor.use(remarkMdxMermaid).use(remarkMermaidMarkdown);
    processor.runSync(tree);
    const processed = defaultStringifier({ filterElement: () => true }).call(processor, tree, undefined);
    expect(processed).toBe(`A label can mention \`\`\`code\`\`\`.\n\n\`\`\`\`mermaid\n${chart}\n\`\`\`\`\n`);
  });

  it("preserves diagram component examples and TypeScript generics inside fences", () => {
    const code = '```tsx\nconst chart = <Mermaid chart="flowchart LR" />;\nconst items: Array<string> = [];\n```';
    expect(toAgentMarkdown(code)).toBe(code);
  });

  it("expands symbol components while preserving their literal code examples", async () => {
    const markdown = '<ApiIndex />\n\n```mdx\n<ApiIndex />\n```\n\n~~~mdx\n<ApiIndex />\n~~~';
    expect(await transformMarkdownHtml(markdown, (prose) => prose.replace(/<ApiIndex\s*\/>/g, "Symbol list")))
      .toBe('Symbol list\n\n```mdx\n<ApiIndex />\n```\n\n~~~mdx\n<ApiIndex />\n~~~');
  });
  it("reduces package-manager tabs to the npm command", () => {
    const tabs = '<CodeBlockTabs defaultValue="npm">\n  <CodeBlockTabsList>\n    <CodeBlockTabsTrigger value="npm">\n      npm\n    </CodeBlockTabsTrigger>\n  </CodeBlockTabsList>\n\n  <CodeBlockTab value="npm">\n    ```bash\n    npm install docture zod\n    ```\n  </CodeBlockTab>\n\n  <CodeBlockTab value="pnpm">\n    ```bash\n    pnpm add docture zod\n    ```\n  </CodeBlockTab>\n</CodeBlockTabs>';
    expect(toAgentMarkdown(`## Install [#install]\n\n${tabs}\n`)).toBe("## Install\n\n```bash\nnpm install docture zod\n```\n");
  });

  it("drops the compile marker from code fences", () => {
    expect(toAgentMarkdown("```ts check\nconst a = 1;\n```")).toBe("```ts\nconst a = 1;\n```");
    expect(toAgentMarkdown('```ts check title="example.ts"\nconst a = 1;\n```'))
      .toBe('```ts title="example.ts"\nconst a = 1;\n```');
  });

  it("drops MDX comments such as options-table annotations", () => {
    expect(toAgentMarkdown("{/* options: GateOptions */}\n| Option | Default |\n")).toBe("| Option | Default |\n");
  });

  it("turns cards into a link list", () => {
    const cards = '<Cards className="x">\n  <Card title="Extraction" href="/docs/extraction" description="Read typed fields." />\n\n  <Card title="CLI" href="/docs/cli" />\n</Cards>';
    expect(toAgentMarkdown(cards)).toBe("- [Extraction](/docs/extraction): Read typed fields.\n- [CLI](/docs/cli)");
  });
});

describe("llms.txt index", () => {
  it("lists every page under its area with Markdown links", () => {
    const tree: Root = {
      name: "Docs",
      children: [
        { type: "page", name: "Home", url: "/docs" },
        {
          type: "folder",
          name: "Extraction",
          index: { type: "page", name: "Extraction", url: "/docs/extraction" },
          children: [{ type: "separator", name: "Start" }, { type: "page", name: "Quick start", url: "/docs/extraction/quick-start" }],
        },
      ],
    };
    const pages: Record<string, { title: string; description?: string }> = {
      "/docs": { title: "Documentation", description: "Start here." },
      "/docs/extraction": { title: "Extraction", description: "Read fields." },
      "/docs/extraction/quick-start": { title: "Extract your first document" },
    };
    const index = llmsIndex({ tree, page: (url) => pages[url], link: (url) => `https://docture.dev${url}`, release: "0.2.x" });
    expect(index.split("\n").slice(0, 2)).toEqual(["# docture", ""]);
    expect(index).toContain("## Overview\n\n- [Documentation](https://docture.dev/docs.md): Start here.\n");
    expect(index).toContain("## Extraction\n\nEvery Extraction page in one file: [extraction.txt](https://docture.dev/llms-full/extraction.txt)\n\n- [Extraction](https://docture.dev/docs/extraction.md): Read fields.\n- [Extract your first document](https://docture.dev/docs/extraction/quick-start.md)\n");
  });
});
