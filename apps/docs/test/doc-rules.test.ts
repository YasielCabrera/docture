import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { checkAdditionalDocs } from "../scripts/additional-docs.js";
import { checkCliInvocations, checkErrorTable, checkExampleCounts, checkOptionsTables } from "../scripts/doc-rules.js";

describe("documentation drift rules", () => {
  it("rejects the incomplete error table and accepts the complete table", () => {
    const codes = ["LOAD_FAILED", "SPLIT_FAILED", "UNCLASSIFIED_GROUP"];
    expect(checkErrorTable("| `LOAD_FAILED` | Every loader failed |", codes))
      .toEqual(["Error table is missing SPLIT_FAILED", "Error table is missing UNCLASSIFIED_GROUP"]);
    expect(checkErrorTable(codes.map((code) => "| `" + code + "` | Meaning |").join("\n"), codes)).toEqual([]);
  });
  it("rejects workspace commands without a binary and accepts an installed CLI", () => {
    const bins = new Map([["docture", false], ["@docture/core", false], ["@docture/cli", true]]);
    expect(checkCliInvocations("npx docture extract in.pdf\npnpm dlx @docture/core", bins))
      .toEqual(["Command package has no binary: docture", "Command package has no binary: @docture/core"]);
    expect(checkCliInvocations("npm install --save-dev @docture/cli\nnpx docture extract in.pdf\npnpm dlx @docture/cli", bins)).toEqual([]);
  });
  it("rejects the old raster constructor table and accepts its actual properties", () => {
    const options = new Map([["NapiCanvasRasterizerOptions", ["dpi", "format", "quality", "maxEdge", "password"]]]);
    const table = (names: string[]) => "<!-- options: NapiCanvasRasterizerOptions -->\n| Option | Default |\n| --- | --- |\n" +
      names.map((name) => "| `" + name + "` | none |").join("\n") + "\n";
    expect(checkOptionsTables(table(["dpi", "format", "quality", "maxEdge", "pages"]), options))
      .toEqual(["Options table differs from NapiCanvasRasterizerOptions"]);
    expect(checkOptionsTables(table(["dpi", "format", "quality", "maxEdge", "password"]), options)).toEqual([]);
    expect(checkOptionsTables(
      table(["dpi", "format", "quality", "maxEdge", "password"]).replace(
        "<!-- options: NapiCanvasRasterizerOptions -->", "{/* options: NapiCanvasRasterizerOptions */}",
      ), options,
    )).toEqual([]);
  });
  it("rejects the old home count and accepts the measured example census", () => {
    const counts = { total: 16, keyless: 11, partial: 4, offline: 12 };
    expect(checkExampleCounts("Fifteen examples. Eleven need no key.", counts))
      .toEqual(["Example counts disagree with the example census"]);
    expect(checkExampleCounts("the eleven that run without a key", counts))
      .toEqual(["Offline count disagrees with the script"]);
    expect(checkExampleCounts("Sixteen examples. Eleven need no API key, and four more run part of the way without one.\nThe offline script runs twelve examples without an API key.", counts)).toEqual([]);
  });

  it("reads package READMEs, examples, constructor references and home components", async () => {
    const root = await mkdtemp(join(tmpdir(), "docture-doc-corpus-"));
    const write = async (file: string, text: string) => {
      const target = join(root, file);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, text);
    };
    try {
      await write("README.md", "# Documentation\n");
      await write("packages/docture/package.json", '{"name":"docture"}');
      await write("packages/docture/README.md", "| `LOAD_FAILED` | Meaning |\n");
      await write("packages/cli/package.json", '{"name":"@docture/cli","bin":"cli.js"}');
      await write("apps/examples/package.json", '{"scripts":{"offline":"pnpm first"}}');
      await write("apps/examples/README.md", "| 01 | first | Example | — |\n");
      await write("apps/examples/01-first/index.ts", 'const command = "npx docture extract input.pdf";');
      await write("apps/docs/components/home/proof.tsx", 'const claim = "Fifteen examples. Eleven need no key.";');
      await write("apps/docs/content/docs/reference/api/raster.mdx",
        "<!-- options: NapiCanvasRasterizerOptions -->\n| Option | Default |\n| --- | --- |\n| `pages` | all |\n");
      const program = ts.createProgram([
        fileURLToPath(new URL("../../../packages/docture/src/index.ts", import.meta.url)),
        fileURLToPath(new URL("../../../packages/docture/src/raster/canvas/index.ts", import.meta.url)),
      ], { target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true });
      const failures = await checkAdditionalDocs(root, program);
      expect(failures.some((failure) => failure.startsWith("packages/docture/README.md: Error table is missing"))).toBe(true);
      expect(failures).toContain("apps/examples/01-first/index.ts: Command package has no binary: docture");
      expect(failures).toContain("apps/docs/components/home/proof.tsx: Example counts disagree with the example census");
      expect(failures).toContain("apps/docs/content/docs/reference/api/raster.mdx: Options table differs from NapiCanvasRasterizerOptions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
