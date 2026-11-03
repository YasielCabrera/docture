import { describe, expect, it } from "vitest";
import { createDocumentationSearch, searchBreadcrumbs, type SearchPage } from "../lib/search";

const pages: SearchPage[] = [
  { url: "/docs/conversion/quick-start", title: "Convert your first PDF", description: "Generate a PDF and convert it to Markdown.", tasks: ["PDF to Markdown", "Convert a PDF without a model"], structuredData: { headings: [], contents: [] } },
  { url: "/docs/resources/migration", title: "Upgrade between releases", tasks: [], structuredData: { headings: [], contents: [{ heading: undefined, content: "PDF to Markdown. Convert a PDF. PDF to Markdown." }] } },
  { url: "/docs/extraction/reference/extractor", title: "Extractor API", tasks: [], structuredData: { headings: [{ id: "createextractor", content: "createExtractor" }], contents: [{ heading: "createextractor", content: "Create an extractor with explicit loaders and strategies." }] } },
  { url: "/docs/synthetic/corpora", title: "Build reproducible synthetic corpora", description: "Write verified cases and preserve their provenance.", tasks: ["Generate a synthetic corpus"], structuredData: { headings: [], contents: [] } },
  { url: "/docs/architecture", title: "Architecture", tasks: [], structuredData: { headings: [], contents: [] } },
];

describe("documentation search", () => {
  const search = createDocumentationSearch(pages);

  it("ranks a task guide before incidental mentions in migration prose", async () => {
    const results = await search.search("PDF to Markdown");
    expect(results[0]?.url).toBe("/docs/conversion/quick-start");
    expect(results[0]?.content).toContain("Convert your first");
  });

  it("finds a task from a differently worded query and returns each destination once", async () => {
    const results = await search.search("turn a PDF into Markdown");
    expect(results[0]?.url).toBe("/docs/conversion/quick-start");
    expect(results.filter((result) => result.type === "page" && result.url === "/docs/conversion/quick-start")).toHaveLength(1);
  });

  it("keeps function words from promoting unrelated title prefixes", async () => {
    const results = await search.search("build a dataset of synthetic invoices");
    expect(results[0]?.url).toBe("/docs/synthetic/corpora");
  });

  it("keeps exact symbol lookups pointed at their reference heading", async () => {
    const results = await search.search("createExtractor");
    expect(results[0]?.url).toBe("/docs/extraction/reference/extractor");
    expect(results.some((result) => result.url === "/docs/extraction/reference/extractor#createextractor")).toBe(true);
  });

  it("finds API names from a partially typed prefix", async () => {
    const results = await search.search("createExtr");
    expect(results[0]?.url).toBe("/docs/extraction/reference/extractor");
    expect(results.some((result) => result.url === "/docs/extraction/reference/extractor#createextractor")).toBe(true);
  });

  it("keeps each page with its headings and distinct matched snippets", async () => {
    const entries = ["Alpha", "Beta"].map((name) => ({
      url: `/docs/${name.toLowerCase()}`,
      title: `${name} options API`,
      description: `Configure ${name.toLowerCase()} options.`,
      tasks: [],
      structuredData: { headings: [{ id: "options", content: "Options" }], contents: [] },
    }));
    const results = await createDocumentationSearch(entries).search("options");
    expect(results.map(({ type, url }) => [type, url])).toEqual([
      ["page", "/docs/alpha"], ["heading", "/docs/alpha#options"], ["text", "/docs/alpha"],
      ["page", "/docs/beta"], ["heading", "/docs/beta#options"], ["text", "/docs/beta"],
    ]);
    expect(results[2]?.content).toBe("Configure alpha <mark>options</mark>.");
  });

  it("retains breadcrumb context on preferred search pages", async () => {
    const entry = {
      url: "/docs/conversion/quick-start", title: "Convert your first PDF", tasks: ["PDF to Markdown"],
      structuredData: { headings: [], contents: [] }, breadcrumbs: ["Getting started", "Conversion"],
    };
    const results = await createDocumentationSearch([entry]).search("PDF to Markdown");
    expect(results[0]?.breadcrumbs).toEqual(["Getting started", "Conversion"]);
  });

  it("derives source breadcrumbs for folder indexes and nested references", () => {
    const tree = { name: "Documentation", children: [{ type: "folder" as const, name: "Conversion", index: { type: "page" as const, name: "Conversion", url: "/docs/conversion" }, children: [
      { type: "folder" as const, name: "Reference", children: [{ type: "page" as const, name: "Options", url: "/docs/conversion/reference/options" }] },
    ] }] };
    expect(searchBreadcrumbs(tree, "/docs/conversion")).toEqual(["Documentation", "Conversion"]);
    expect(searchBreadcrumbs(tree, "/docs/conversion/reference/options")).toEqual(["Documentation", "Conversion", "Reference"]);
    expect(searchBreadcrumbs(tree, "/missing")).toBeUndefined();
  });
});
