import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("config validation", () => {
  it("names the config and invalid loaders field as a usage error", async () => {
    const cwd = await tempDir("config-loaders");
    const path = await writeFixture(cwd, "docture.config.mjs", 'export default { loaders: "pdfjs" };');
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    const result = await cli(["inspect", "a.pdf"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(path);
    expect(result.stderr).toContain("loaders");
  });

  it("suggests the known field for an unknown config key", async () => {
    const cwd = await tempDir("config-typo");
    await writeFixture(cwd, "docture.config.mjs", "export default { loader: [] };");
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    const result = await cli(["inspect", "a.pdf"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Did you mean "loaders"?');
  });

  it("validates every known option at the loading boundary", async () => {
    for (const [field, value] of [
      ["strategies", '"llm"'], ["classifiers", "[{}]"], ["classifications", "[{}]"],
      ["policy", "4"], ["stageTimeoutMs", "-1"], ["layoutAnalyzer", "{}"],
      ["model", "4"], ["vision", '"yes"'], ["pricing", '{test:{inputPerMillion:-1,outputPerMillion:1}}'],
      ["instructions", "false"], ["schema", "4"], ["cacheDir", "4"], ["concurrency", "1.5"],
      ["extractor", "{}"], ["converter", "{}"],
    ]) {
      const cwd = await tempDir("config-field");
      const path = await writeFixture(cwd, "docture.config.mjs", `export default { ${field}: ${value} };`);
      const result = await resolveConfig({ cwd }).then(() => null, (error: unknown) => error);
      expect(result, field).toMatchObject({ name: "UsageError", exitCode: 2 });
      expect(result instanceof Error ? result.message : "").toContain(field);
      expect(result instanceof Error ? result.message : "").toContain(path);
    }
  });

  it("validates extractor and converter factory results before using them", async () => {
    for (const kind of ["extractor", "converter"]) {
      const cwd = await tempDir("config-factory");
      const path = await writeFixture(cwd, "docture.config.mjs", `export default { ${kind}: async () => ({}) };`);
      await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
      await writeFixture(cwd, "schema.json", '{"type":"object"}');
      const args = kind === "extractor"
        ? ["extract", "a.pdf", "-s", "schema.json"]
        : ["convert", "a.pdf", "--out", "converted"];
      const result = await cli(args, { cwd });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(kind);
      expect(result.stderr).toContain(path);
    }
  });

  it("keeps valid structural components and gateway model strings", async () => {
    const cwd = await tempDir("config-structural");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"], "{name:'fixed',async extract(){return {data:{}};}}")
      .replace("export default {", "export default { model: 'openai/test', concurrency: 2, vision: false,"));
    const loaded = await resolveConfig({ cwd });
    expect(loaded?.config.loaders?.[0]?.name).toBe("fake");
    expect(loaded?.config.strategies?.[0]?.name).toBe("fixed");
    expect(loaded?.config.model).toBe("openai/test");
    expect(loaded?.config.concurrency).toBe(2);
  });
});
