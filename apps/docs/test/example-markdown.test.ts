import { describe, expect, it } from "vitest";
import { expandSourceExamples, readExampleSource } from "../lib/example-source";

describe("agent-readable examples", () => {
  it("retains the displayed filename and falls back to the source filename", async () => {
    const markdown = await expandSourceExamples('<SourceExample file="with-a-model.ts" title="extract-invoice.mts" />\n<SourceExample file="invoice.ts" />');
    expect(markdown).toContain('```ts title="extract-invoice.mts"');
    expect(markdown).toContain('```ts title="invoice.ts"');
    expect(markdown).toContain(await readExampleSource("with-a-model.ts"));
  });

  it("includes schema and extractor source instead of component tags", async () => {
    const markdown = await expandSourceExamples('<SourceExample file="invoice.ts" title="invoice.ts" />\n<SourceExample file="quick-start/with-a-model.ts" />');
    expect(markdown).toContain("contract(");
    expect(markdown).toContain("new Extractor()");
    expect(markdown).toContain("```ts");
    expect(markdown).not.toContain("<SourceExample");
  });

  it("keeps source outside example components unchanged", async () => {
    expect(await expandSourceExamples("## Result\n\nUse `result.data`.\n")).toBe("## Result\n\nUse `result.data`.\n");
  });

  it("rejects paths outside the example directory", async () => {
    await expect(readExampleSource("../package.json")).rejects.toThrow("Example path leaves the examples directory");
  });
});
