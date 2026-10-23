import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DocumentFeatures } from "docture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { explain } from "../src/cli/errors.js";
import { INVOICE_JSON_SCHEMA, cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

type ErrorsModule = typeof import("../../docture/src/core/pipeline/errors.js");

const source = fileURLToPath(new URL("../../docture/src/core/pipeline/errors.ts", import.meta.url));
let copy: ErrorsModule;

beforeAll(async () => {
  const dir = await tempDir("second-copy");
  await copyFile(source, join(dir, "errors.ts"));
  copy = await import(pathToFileURL(join(dir, "errors.ts")).href);
});

afterAll(cleanup);

const features: DocumentFeatures = {
  mimeType: "application/pdf",
  pageCount: 1,
  textLength: 40,
  hasTextLayer: true,
  hasGeometry: true,
  hasRenderablePages: false,
  form: "digital",
};

describe("errors raised by another installed copy of docture", () => {
  it("are explained with their code and hint", () => {
    const explained = explain(new copy.NoEligibleStrategyError(features, []));

    expect(explained.code).toBe("NO_ELIGIBLE_STRATEGY");
    expect(explained.hint).toBe(
      "The document loaded but nothing wired can read it. A scan has no text layer: " +
        "add --vision to render the pages and send them to a vision model.",
    );
  });

  it("keep the usage of a failed model call in the extraction record", async () => {
    const dir = await tempDir("foreign-usage");
    await copyFile(source, join(dir, "errors.ts"));
    const config = textLoaderConfig(
      ["Invoice INV-1 total 42"],
      `{
        name: "bad",
        async extract() {
          throw new ModelOutputError("unparseable", { usage: { inputTokens: 1000, outputTokens: 250 } });
        },
      },
      {
        name: "good",
        async extract() {
          return { data: { invoiceNumber: "INV-1", total: 42 }, usage: { inputTokens: 10, outputTokens: 5 } };
        },
      }`,
    );
    await writeFixture(dir, "docture.config.mjs", `import { ModelOutputError } from "./errors.ts";\n${config}`);
    await writeFixture(dir, "invoice.schema.json", INVOICE_JSON_SCHEMA);
    await writeFixture(dir, "invoice.pdf", "%PDF-1.7 pretend");

    const run = await cli(
      ["extract", "invoice.pdf", "-s", "./invoice.schema.json", "--format", "ndjson", "--full"],
      { cwd: dir },
    );

    expect(run.code).toBe(0);
    const record = z
      .object({
        usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
        attempts: z.array(
          z.object({
            strategy: z.string(),
            errorCode: z.string().optional(),
            usage: z.object({ inputTokens: z.number().optional() }).optional(),
          }),
        ),
      })
      .parse(JSON.parse(run.stdout));
    expect([record.usage.inputTokens, record.usage.outputTokens]).toEqual([1010, 255]);
    expect(record.attempts.map(({ strategy, errorCode, usage }) => ({ strategy, errorCode, inputTokens: usage?.inputTokens }))).toEqual([
      { strategy: "bad", errorCode: "MODEL_OUTPUT_FAILED", inputTokens: 1000 },
      { strategy: "good", errorCode: undefined, inputTokens: 10 },
    ]);
  });
});
