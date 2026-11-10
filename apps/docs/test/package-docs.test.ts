import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { toAgentMarkdown } from "../lib/agent-markdown";
import { expandSourceExamples } from "../lib/example-source";
import { documentationRelease, writeDocumentation } from "../scripts/package-docs";
import { rewriteMarkdownLinks } from "../lib/markdown-links";
import { offlineLink, validateDocumentationLinks } from "../scripts/package-docs-markdown";

const run = promisify(execFile);
const temporary: string[] = [];

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "docture-docs-test-"));
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("offline documentation", () => {
  it("rewrites navigable links and keeps fenced and inline examples intact", () => {
    const routes = new Map([["/docs", "index.md"], ["/docs/reference", "reference/index.md"], ["/api-symbols.json", "api-symbols.json"]]);
    const prose = '[Home](/docs) [API](/docs/reference#options) [Symbols](/api-symbols.json)\n\n`[API](/docs/reference)`\n\n```mdx\n<SourceExample file="sample.ts" />\n[API](/docs/reference)\n```';
    const output = rewriteMarkdownLinks(prose, (url) => offlineLink({ url, from: "guides/start.md", routes, revision: "abc123" }));
    expect(output).toContain("[Home](../index.md)");
    expect(output).toContain("[API](../reference/index.md#options)");
    expect(output).toContain("[Symbols](../api-symbols.json)");
    expect(output).toContain("`[API](/docs/reference)`");
    expect(output).toContain('<SourceExample file="sample.ts" />\n[API](/docs/reference)');
    expect(offlineLink({ url: "https://github.com/YasielCabrera/docture/blob/main/README.md", from: "index.md", routes, revision: "abc123" }))
      .toBe("https://github.com/YasielCabrera/docture/blob/abc123/README.md");
  });

  it("rejects missing files, missing anchors, and unexpanded components", () => {
    expect(() => validateDocumentationLinks(new Map([["index.md", "[Missing](missing.md)"]]))).toThrow("missing local documentation target");
    expect(() => validateDocumentationLinks(new Map([["index.md", "[Missing](guide.md#missing)"], ["guide.md", "# Guide\n\n## Present"]]))).toThrow("missing documentation anchor");
    expect(() => rewriteMarkdownLinks("<UnknownContent />", (url) => url)).toThrow("Unsupported HTML or MDX");
    expect(() => validateDocumentationLinks(new Map([["index.md", "[Options](guide.md#options-1)"], ["guide.md", "# Guide\n\n## Options\n\n## Options"]]))).not.toThrow();
  });

  it("follows heading IDs for collisions, repeated spaces, and repeated hyphens", () => {
    const links = ["options", "options-1", "options-2", "spacing--matters", "version--two"].map((id) => `[Heading](guide.md#${id})`).join("\n");
    const guide = "# Options\n\n## Options-1\n\n## Options\n\n## Spacing  matters\n\n## Version--two";
    expect(() => validateDocumentationLinks(new Map([["index.md", links], ["guide.md", guide]]))).not.toThrow();
  });

  it("keeps relative links inside the documentation directory", () => {
    for (const target of ["../index.md", "../../index.md", "..%2findex.md", "..\\index.md"]) {
      expect(() => validateDocumentationLinks(new Map([["index.md", `[Outside](${target})`]]))).toThrow("Invalid local documentation link");
    }
    expect(() => validateDocumentationLinks(new Map([["guides/start.md", "[Home](../index.md)"], ["index.md", "# Home"]]))).not.toThrow();
  });

  it("preserves documentation component examples in code spans and nested fences", async () => {
    const example = '<SourceExample file="../must-not-be-read.ts" />';
    const markdown = `\`${example}\`\n\n\`\`\`\`mdx\n${example}\n<Cards><Card title="Example" href="/docs" /></Cards>\n\`\`\`ts check\nconst value = 1;\n\`\`\`\n\`\`\`\``;
    expect(await expandSourceExamples(markdown)).toBe(markdown);
    expect(toAgentMarkdown(markdown)).toBe(markdown);
  });

  it("replaces complete generated snapshots and preserves unrelated directories", async () => {
    const parent = await directory();
    const output = join(parent, "docs");
    const files = new Map([["manifest.json", JSON.stringify({ schemaVersion: 1, packageName: "docture" })], ["index.md", "# Current\n"]]);
    await writeDocumentation(output, files);
    await writeFile(join(output, "deleted-guide.md"), "stale");
    await writeDocumentation(output, files);
    expect((await readdir(output)).sort()).toEqual(["index.md", "manifest.json"]);
    expect(await readFile(join(output, "index.md"), "utf8")).toBe("# Current\n");
    await expect(writeDocumentation(output, new Map([["../outside.md", "escape"]]))).rejects.toThrow("leaves its directory");
    expect(await readFile(join(output, "index.md"), "utf8")).toBe("# Current\n");
    const unrelated = join(parent, "user-files");
    await mkdir(unrelated);
    await writeFile(join(unrelated, "keep.txt"), "keep");
    await expect(writeDocumentation(unrelated, files)).rejects.toThrow();
    expect(await readFile(join(unrelated, "keep.txt"), "utf8")).toBe("keep");
  });

  it("marks source archives and dirty checkouts unreleased and gates publication", async () => {
    const root = await directory();
    for (const folder of ["docture", "cli", "eval", "synthetic"]) {
      await mkdir(join(root, "packages", folder), { recursive: true });
      await writeFile(join(root, "packages", folder, "package.json"), JSON.stringify({ name: folder === "docture" ? folder : `@docture/${folder}`, version: "0.2.0" }));
      await writeFile(join(root, "packages", folder, "CHANGELOG.md"), `# ${folder}\n`);
    }
    expect(await documentationRelease(root, false)).toMatchObject({ sourceRevision: null, sourceDirty: null, releaseStatus: "unreleased" });
    await expect(documentationRelease(root, true)).rejects.toThrow("Git source revision");
    const git = (...args: string[]) => run("git", ["-c", "user.name=Docture test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(root, ".git", "disabled-hooks")}`, ...args], { cwd: root });
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Documentation release fixture");
    expect(await documentationRelease(root, true)).toMatchObject({ sourceDirty: false, releaseStatus: "release" });
    const worktree = join(await directory(), "linked checkout");
    await git("worktree", "add", "--quiet", "--detach", worktree, "HEAD");
    expect(await documentationRelease(worktree, true)).toEqual(await documentationRelease(root, true));
    const changelog = join(root, "packages", "cli", "CHANGELOG.md");
    await writeFile(changelog, "# cli\n\n## Unreleased\n\n- Pending note\n");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Unreleased notes fixture");
    expect(await documentationRelease(root, false)).toMatchObject({ sourceDirty: false, releaseStatus: "unreleased" });
    await expect(documentationRelease(root, true)).rejects.toThrow("Unreleased section");
    await writeFile(changelog, "# cli\n\n## 0.2.0\n\n- Pending note\n");
    expect(await documentationRelease(root, false)).toMatchObject({ sourceDirty: true, releaseStatus: "unreleased" });
    await expect(documentationRelease(root, true)).rejects.toThrow("clean checkout");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Versioned notes fixture");
    expect(await documentationRelease(root, true)).toMatchObject({ sourceDirty: false, releaseStatus: "release" });
    await writeFile(join(root, "new-guide.md"), "Untracked");
    await expect(documentationRelease(root, true)).rejects.toThrow("clean checkout");
    await writeFile(join(root, "packages", "eval", "package.json"), JSON.stringify({ name: "@docture/eval", version: "0.3.0" }));
    await expect(documentationRelease(root, false)).rejects.toThrow("matching versions");
  });

  it("does not attribute a nested source copy to its enclosing repository", async () => {
    const parent = await directory();
    const root = join(parent, "source copy");
    for (const folder of ["docture", "cli", "eval", "synthetic"]) {
      await mkdir(join(root, "packages", folder), { recursive: true });
      await writeFile(join(root, "packages", folder, "package.json"), JSON.stringify({ name: folder === "docture" ? folder : `@docture/${folder}`, version: "0.2.0" }));
      await writeFile(join(root, "packages", folder, "CHANGELOG.md"), `# ${folder}\n`);
    }
    await writeFile(join(parent, ".gitignore"), "source copy/\n");
    const git = (...args: string[]) => run("git", ["-c", "user.name=Docture test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(parent, ".git", "disabled-hooks")}`, ...args], { cwd: parent });
    await git("init", "--quiet");
    await git("add", ".gitignore");
    await git("commit", "--quiet", "-m", "Enclosing repository fixture");
    expect(await documentationRelease(root, false)).toMatchObject({ sourceRevision: null, sourceDirty: null, releaseStatus: "unreleased" });
    await expect(documentationRelease(root, true)).rejects.toThrow("Git source revision");
  });

  it("builds the real corpus reproducibly without a website build", async () => {
    const output = join(await directory(), "docs");
    const build = () => run(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/build-package-docs.ts"), "--output", output], { cwd: process.cwd(), timeout: 120_000, maxBuffer: 2_000_000 });
    await build();
    const first = await readFile(join(output, "manifest.json"), "utf8");
    const manifest = z.object({ schemaVersion: z.literal(1), packageName: z.literal("docture"), pages: z.array(z.object({ path: z.string() })), files: z.array(z.object({ path: z.string(), sha256: z.string() })) }).parse(JSON.parse(first));
    expect(manifest.pages.map((page) => page.path)).toContain("extraction/quick-start.md");
    expect(await readFile(join(output, "LICENSE"), "utf8")).toBe(await readFile(resolve("../../LICENSE"), "utf8"));
    expect(manifest.files.map((file) => file.path)).toContain("schemas/docture-document-v2.schema.json");
    expect(await readFile(join(output, "llms.txt"), "utf8")).not.toContain("llms-full");
    const guide = await readFile(join(output, "extraction/quick-start.md"), "utf8");
    expect(guide).toContain("new Extractor()");
    expect(guide).not.toContain("<SourceExample");
    expect(guide).toContain("../getting-started/installation.md");
    expect(guide).toContain('title="make-invoice.mts"');
    const model = await readFile(join(output, "extraction/with-a-model.md"), "utf8");
    expect(model).toContain('title="invoice.ts"');
    expect(model).toContain('title="extract-invoice.mts"');
    expect(model).toContain("export const Invoice = contract(");
    const symbols = z.array(z.object({ url: z.string(), markdownUrl: z.string() })).parse(JSON.parse(await readFile(join(output, "api-symbols.json"), "utf8")));
    for (const symbol of symbols) {
      expect(symbol.markdownUrl).toBe(symbol.url);
      expect(symbol.markdownUrl).not.toMatch(/^(?:\/|https?:)/);
    }
    await writeFile(join(output, "removed.md"), "stale page");
    await build();
    expect(await readFile(join(output, "manifest.json"), "utf8")).toBe(first);
    await expect(readFile(join(output, "removed.md"))).rejects.toThrow();
  }, 120_000);
});
