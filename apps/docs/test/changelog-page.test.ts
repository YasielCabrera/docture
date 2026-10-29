import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const docs = new URL("../content/docs/resources/", import.meta.url);
const repository = new URL("../../../", import.meta.url);
const blob = "https://github.com/YasielCabrera/docture/blob/main/";

const changelogLinks = (): string[] => {
  const page = readFileSync(new URL("changelog.mdx", docs), "utf8");
  return [...page.matchAll(/\]\((https:\/\/github\.com\/[^)\s]+)\)/g)].map((match) => match[1] ?? "");
};

describe("changelog reference page", () => {
  it("appears in the Resources sidebar", () => {
    const meta = JSON.parse(readFileSync(new URL("meta.json", docs), "utf8")) as { pages: string[] };
    expect(meta.pages).toContain("changelog");
  });

  it("links the changelog of each published package on GitHub", () => {
    expect(changelogLinks()).toEqual([
      "https://github.com/YasielCabrera/docture/blob/main/packages/docture/CHANGELOG.md",
      "https://github.com/YasielCabrera/docture/blob/main/packages/cli/CHANGELOG.md",
      "https://github.com/YasielCabrera/docture/blob/main/packages/eval/CHANGELOG.md",
      "https://github.com/YasielCabrera/docture/blob/main/packages/synthetic/CHANGELOG.md",
    ]);
  });

  it("links only changelogs that exist in the repository", () => {
    const missing = changelogLinks()
      .map((href) => href.slice(blob.length))
      .filter((path) => !existsSync(fileURLToPath(new URL(path, repository))));
    expect(missing).toEqual([]);
    expect(changelogLinks()).toHaveLength(4);
  });
});
