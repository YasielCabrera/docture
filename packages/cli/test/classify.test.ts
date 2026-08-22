import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

/**
 * A classifier that decides from the text, so the command can be exercised without
 * a model. The `Classifier` contract is structural — this object IS one.
 */
const CONFIG = `export default {
  loaders: [
    {
      name: "fake",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
      async load(raw) {
        const text = new TextDecoder().decode(raw.bytes);
        return {
          pages: [{ pageNumber: 1, width: 595, height: 842, text }],
          text,
          form: "digital",
          loader: "fake",
        };
      },
    },
  ],
  classifiers: [
    {
      name: "keyword",
      async classify(ctx) {
        for (const candidate of ctx.candidates) {
          if (ctx.document.text.toLowerCase().includes(candidate.name)) {
            return { classifier: "keyword", name: candidate.name, confidence: 0.9 };
          }
        }
        return { classifier: "keyword", name: null, confidence: 0, note: "no keyword matched" };
      },
    },
  ],
};
`;

const KINDS = `export const classifications = [
  { name: "invoice", description: "a bill", schema: { type: "object" } },
  { name: "receipt", description: "proof of payment", schema: { type: "object" } },
];
`;

async function workspace(): Promise<string> {
  const dir = await tempDir("classify");
  await writeFixture(dir, "docture.config.mjs", CONFIG);
  await writeFixture(dir, "kinds.mjs", KINDS);
  await writeFixture(dir, "one.txt", "This invoice is due on the first.");
  await writeFixture(dir, "two.txt", "Your receipt for today's purchase.");
  await writeFixture(dir, "three.txt", "A memo about nothing in particular.");
  return dir;
}

describe("classify", () => {
  it("reports a verdict per document", async () => {
    const cwd = await workspace();
    const run = await cli(
      ["classify", "one.txt", "two.txt", "--classifications", "./kinds.mjs", "--json"],
      { cwd },
    );

    expect(run.code).toBe(0);
    const verdicts = JSON.parse(run.stdout) as { file: string; name: string; confidence: number }[];
    expect(verdicts).toEqual([
      expect.objectContaining({ file: "one.txt", name: "invoice", confidence: 0.9 }),
      expect.objectContaining({ file: "two.txt", name: "receipt", confidence: 0.9 }),
    ]);
  });

  it("says UNKNOWN rather than guessing", async () => {
    const cwd = await workspace();
    const run = await cli(["classify", "three.txt", "--classifications", "./kinds.mjs", "--json"], {
      cwd,
    });

    const verdicts = JSON.parse(run.stdout) as { name: string }[];
    expect(verdicts[0]?.name).toBe("UNKNOWN");
    expect(run.code).toBe(0);
  });

  it("prints an aligned table by default", async () => {
    const cwd = await workspace();
    const run = await cli(["classify", "one.txt", "two.txt", "--classifications", "./kinds.mjs"], {
      cwd,
    });

    expect(run.stdout).toMatch(/one\.txt\s+invoice\s+90%/);
    expect(run.stdout).toMatch(/two\.txt\s+receipt\s+90%/);
  });

  it("shows every classifier's signal under --verbose, abstentions included", async () => {
    const cwd = await workspace();
    const run = await cli(
      ["classify", "three.txt", "--classifications", "./kinds.mjs", "--verbose"],
      { cwd },
    );

    expect(run.stdout).toContain("keyword: abstained");
    expect(run.stdout).toContain("no keyword matched");
  });

  it("refuses to run with no candidate kinds", async () => {
    const cwd = await workspace();
    const run = await cli(["classify", "one.txt"], { cwd });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("candidate document kinds");
  });

  it("refuses to run with kinds but nothing to choose between them", async () => {
    const dir = await tempDir("classify-noclassifier");
    await writeFixture(dir, "kinds.mjs", KINDS);
    await writeFixture(dir, "one.txt", "This invoice is due on the first.");

    const run = await cli(["classify", "one.txt", "--classifications", "./kinds.mjs", "--no-config"], {
      cwd: dir,
    });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Nothing is wired that could classify");
  });

  it("still wires the model's classifier when the config supplies its own strategies", async () => {
    // The bug this guards: a config with `strategies` used to short-circuit model
    // resolution entirely, so `classify --model …` silently got no classifier and
    // answered UNKNOWN for everything.
    const dir = await tempDir("classify-with-strategies");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `${CONFIG.replace("export default {", "export default {\n  strategies: [{ name: \"noop\", async extract() { return { data: {} }; } }],")}`,
    );
    await writeFixture(dir, "kinds.mjs", KINDS);
    await writeFixture(dir, "one.txt", "This invoice is due on the first.");

    const run = await cli(
      ["classify", "one.txt", "--classifications", "./kinds.mjs", "-m", "openai/gpt-5", "--json", "--verbose"],
      { cwd: dir, env: { AI_GATEWAY_API_KEY: "unused — the keyword classifier answers first" } },
    );

    expect(run.code).toBe(0);
    expect(run.stderr).toContain("classifier llm");
    expect(run.stderr).toContain("--model is used for classification only");
    // The keyword classifier is more confident than an unreached model call.
    expect((JSON.parse(run.stdout) as { name: string }[])[0]?.name).toBe("invoice");
  });
});
