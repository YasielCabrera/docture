import { describe, expect, it } from "vitest";
import {
  checkInboundLinks,
  checkMetadata,
  checkOpening,
  checkOutboundLinks,
  checkPageType,
  checkPortableLocalPaths,
  checkSections,
  versionedInstallSpecs,
} from "../scripts/page-rules.js";

const page = (route: string, frontmatter: string, body: string) => ({ route, source: `---\n${frontmatter}\n---\n\n${body}` });
const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

describe("documentation page rules", () => {
  it("rejects a long guide without sections and accepts the same text split into tasks", () => {
    const flat = page("/docs/cli/review", "title: Review results", words(200));
    expect(checkSections(flat)).toEqual([
      "/docs/cli/review: 200 words of prose need at least two H2 sections so readers and search can reach each task",
    ]);
    const sectioned = page("/docs/cli/review", "title: Review results", `## Open the page\n\n${words(100)}\n\n## Share it\n\n${words(100)}`);
    expect(checkSections(sectioned)).toEqual([]);
  });

  it("rejects a section that repeats the page title", () => {
    const echoed = page("/docs/cli/mcp", "title: MCP server", "## MCP server\n\nServe tools.\n\n## Configure clients\n\nAdd it.");
    expect(checkSections(echoed)).toEqual([
      '/docs/cli/mcp: the section "MCP server" repeats the page title; name the task it covers',
    ]);
  });

  it("requires a page type that matches its location and a closing section for tutorials", () => {
    expect(checkPageType(page("/docs/extraction/reference/extractor", "title: Extractor", "Text."))).toEqual([
      "/docs/extraction/reference/extractor: add a type to the frontmatter (overview, tutorial, how-to, explanation, reference, troubleshooting)",
    ]);
    expect(checkPageType(page("/docs/extraction/reference/extractor", "type: how-to", "Text."))).toEqual([
      "/docs/extraction/reference/extractor: pages at this location have type reference, not how-to",
    ]);
    expect(checkPageType(page("/docs/cli/quick-start", "type: tutorial", "## Run it"))).toEqual([
      '/docs/cli/quick-start: tutorials end with a "Next steps" section',
    ]);
    expect(checkPageType(page("/docs/cli/quick-start", "type: tutorial", "## Run it\n\n## Next steps"))).toEqual([]);
  });

  it("rejects generic, miscased, and repeated descriptions", () => {
    expect(checkMetadata([
      page("/docs/a", "title: A\ndescription: Public API for docture/a.", ""),
      page("/docs/b", "title: B\ndescription: Write Json reports.", ""),
      page("/docs/c", "title: C\ndescription: Write Json reports.", ""),
      page("/docs/d", "title: Render html and PDF pages\ndescription: Read report.pdf with `html` output.", ""),
    ])).toEqual([
      "/docs/a: replace the generic description with the job this page covers",
      "/docs/b: write JSON instead of Json in the description",
      "/docs/c: write JSON instead of Json in the description",
      "/docs/d: write HTML instead of html in the title",
      '/docs/b, /docs/c: pages share the description "Write Json reports."',
    ]);
  });

  it("requires a purpose sentence before the first heading", () => {
    expect(checkOpening(page("/docs/a", "title: A", "## Install\n\nRun it."))).toEqual([
      "/docs/a: open with a sentence that says what the page is for, before the first heading",
    ]);
    expect(checkOpening(page("/docs/a", "title: A", "Score runs.\n\n## Install"))).toEqual([]);
  });

  it("requires at least one link onward", () => {
    expect(checkOutboundLinks(page("/docs/a", "title: A", "No links."))).toEqual([
      "/docs/a: link at least one related page so a reader arriving from search can go on",
    ]);
    expect(checkOutboundLinks(page("/docs/a", "title: A", "See [B](/docs/b)."))).toEqual([]);
  });

  it("reports pages that no other page links to", () => {
    expect(checkInboundLinks([
      page("/docs", "title: Home", "[Start](/docs/a)"),
      page("/docs/a", "title: A", "[Self](/docs/a)"),
      page("/docs/b", "title: B", "Alone."),
    ])).toEqual(["/docs/b: no other page links here; link it from its area introduction or a related guide"]);
  });

  it("rejects a local path passed to the portable constructor and accepts the Node entry", () => {
    const portable = '```ts\nimport { Extractor } from "docture";\nawait new Extractor().extract("invoice.pdf", Invoice);\n```';
    expect(checkPortableLocalPaths(portable)).toEqual([
      "passes the local path invoice.pdf to a constructor imported from docture; import it from docture/node or pass bytes",
    ]);
    expect(checkPortableLocalPaths(portable.replace('from "docture"', 'from "docture/node"'))).toEqual([]);
    expect(checkPortableLocalPaths(portable.replace('"invoice.pdf"', '"https://example.com/invoice.pdf"'))).toEqual([]);
  });

  it("finds versions in package-install fences as well as shell commands", () => {
    expect(versionedInstallSpecs("```package-install\ndocture pdfjs-dist@6.2.108 zod\n```\nnpm install ai@^7")).toEqual(["ai@^7", "pdfjs-dist@6.2.108"]);
    expect(versionedInstallSpecs("```package-install\ndocture @docture/eval\n```")).toEqual([]);
  });
});
