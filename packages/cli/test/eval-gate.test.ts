import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("CLI eval gates", () => {
  it.each(["throw", "invalid"])("includes billed usage when an extraction fails with %s", async (failure) => {
    const cwd = await tempDir("eval-paid-failure");
    const paid = failure === "throw"
      ? 'throw new ModelOutputError("invalid paid output", {usage});'
      : 'return {data:{total:"invalid"},usage};';
    const config = textLoaderConfig(["Invoice"], `{ name:'paid', async extract() {
      const usage = {inputTokens:100,outputTokens:25,totalTokens:125,costUsd:2}; ${paid}
    } }`);
    await writeFixture(cwd, "docture.config.mjs", 'import {ModelOutputError} from "docture";\n' + config);
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "a.expected.json", '{"total":42}');
    await writeFixture(cwd, "schema.mjs", 'import {z} from "zod"; export default z.object({total:z.number()});');
    const result = await cli(["eval", "a.pdf", "-s", "schema.mjs", "--format", "json", "--max-cost-usd", "1"], { cwd });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      summary: {
        meanF1: 0, totalTokens: 125, totalCostUsd: 2, failed: 1,
        metrics: { meanDocumentF1: 0, costUsd: 2, tokens: 125 }, passed: false,
        reasons: ["Total cost $2.0000 exceeds the --max-cost-usd gate of $1.0000."],
      },
    });
  });

  it("gates cost with actual and threshold values in the uniform envelope", async () => {
    const cwd = await tempDir("eval-cost");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"],
      "{ name:'priced', async extract() { return {data:{total:42},usage:{inputTokens:10,outputTokens:2,totalTokens:12,costUsd:0.02}}; } }"));
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "a.expected.json", '{"total":42}');
    await writeFixture(cwd, "schema.json", '{"type":"object"}');
    const result = await cli(["eval", "a.pdf", "-s", "schema.json", "--format", "json", "--max-cost-usd", "0.01"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("$0.0200");
    expect(result.stderr).toContain("$0.0100");
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: 1, command: "eval", ok: false,
      summary: {
        meanF1: 1, totalCostUsd: 0.02, maxCostUsd: 0.01, passed: false,
        metrics: { f1: 1, costUsd: 0.02, tokens: 12 },
        reasons: ["Total cost $0.0200 exceeds the --max-cost-usd gate of $0.0100."],
      },
    });
    const equal = await cli(["eval", "a.pdf", "-s", "schema.json", "--format", "json", "--max-cost-usd", "0.02"], { cwd });
    expect(equal.code).toBe(0);
    expect(JSON.parse(equal.stdout)).toMatchObject({ ok: true, summary: { passed: true, reasons: [] } });
  });

  it("fails a cost gate when no price is known, because a missing price is not a free run", async () => {
    const cwd = await tempDir("eval-unpriced");
    await writeFixture(cwd, "docture.config.mjs", textLoaderConfig(["Invoice"], "{ name:'free', async extract() { return {data:{total:42}}; } }"));
    await writeFixture(cwd, "a.pdf", "%PDF-1.7 pretend");
    await writeFixture(cwd, "a.expected.json", '{"total":42}');
    await writeFixture(cwd, "schema.json", '{"type":"object"}');
    const result = await cli(["eval", "a.pdf", "-s", "schema.json", "--max-cost-usd", "1"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("✗ Gate failed: 1 of 1 checks.");
  });
});
