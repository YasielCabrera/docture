import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

const CONFIG = `export default {
  concurrency: 1,
  classifications: [{ name: "invoice", description: "invoice", schema: { type: "object" } }],
  loaders: [{
    name: "fake",
    capabilities: { text: true, geometry: true, images: false, mimeTypes: ["*/*"] },
    async load(raw) {
      if (raw.fileName.startsWith("bad")) throw new Error("broken document");
      return { loader: "fake", form: "digital", text: "Invoice", pages: [
        { pageNumber: 1, width: 600, height: 800, text: "Invoice", lines: [] }
      ] };
    }
  }],
  strategies: [{ name: "fixed", async extract() { return { data: {} }; } }],
  classifiers: [{ name: "fixed", async classify() {
    return { classifier: "fixed", name: "invoice", confidence: 1 };
  } }]
};`;

describe("quiet diagnostics", () => {
  it.each(["extract", "convert", "classify", "inspect", "eval"])(
    "%s keeps each failure and the first hint while hiding progress",
    async (command) => {
      const cwd = await tempDir("quiet");
      await writeFixture(cwd, "docture.config.mjs", CONFIG);
      await writeFixture(cwd, "schema.json", '{"type":"object"}');
      for (const file of ["good", "bad-one", "bad-two"]) {
        await writeFixture(cwd, `${file}.pdf`, "%PDF-1.7 pretend");
        await writeFixture(cwd, `${file}.expected.json`, "{}");
      }
      const run = await cli([
        command, "good.pdf", "bad-one.pdf", "bad-two.pdf", "-q",
        ...(["extract", "eval"].includes(command) ? ["-s", "./schema.json"] : []),
        ...(command === "convert" ? ["--out", "converted"] : []),
      ], { cwd });
      expect(run.code).toBe(1);
      expect(run.stderr).toBe(command === "classify"
        ? "✗ bad-one.pdf → broken document\n✗ bad-two.pdf → broken document\n"
        : "✗ bad-one.pdf → Every loader failed: fake (broken document).\n" +
        "  The file could not be read — it may be corrupt, truncated, or password-protected.\n" +
        "✗ bad-two.pdf → Every loader failed: fake (broken document).\n",
      );
    },
  );
});
