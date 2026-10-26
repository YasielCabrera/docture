import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("eval field reporting", () => {
  it("prints the worst normalized fields in verbose output and keeps JSON metrics", async () => {
    const cwd = await tempDir("eval-fields");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"],
      "{ name:'fixed', async extract() { return {data:{invoiceNumber:'INV-9',total:42}}; } }"));
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "a.expected.json", '{"invoiceNumber":"INV-1","total":42}');
    await writeFixture(cwd, "schema.json", '{"type":"object"}');
    const result = await cli(["eval", "a.pdf", "-s", "schema.json", "--verbose", "--format", "json"], { cwd });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Worst fields:");
    expect(result.stderr).toContain("invoiceNumber  F1 0.000");
    expect(JSON.parse(result.stdout).summary.byField.invoiceNumber).toEqual({
      match: 0, mismatch: 1, omission: 0, hallucination: 0, precision: 0, recall: 0, f1: 0,
    });
  });
});
