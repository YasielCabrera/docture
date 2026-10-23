import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

describe("a loader whose engine is not installed", () => {
  it("is reported as a missing engine with an install hint, not as a damaged file", async () => {
    const dir = await tempDir("missing-engine");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `import { MissingEngineError } from "docture";
export default {
  loaders: [
    {
      name: "mupdf",
      capabilities: { text: true, geometry: true, images: false, mimeTypes: ["application/pdf"] },
      async load() {
        throw new MissingEngineError("mupdf", "~1.28.0", "docture/loaders/mupdf");
      },
    },
  ],
};
`,
    );
    await writeFile(join(dir, "invoice.pdf"), (await makeInvoicePdf({ seed: 7 })).bytes);

    const run = await cli(["inspect", "invoice.pdf"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      'docture/loaders/mupdf needs the optional peer mupdf@~1.28.0, which is not installed. ' +
        'Install it beside docture: npm install "mupdf@~1.28.0".',
    );
    expect(run.stderr).toContain(
      "The file was not read. Install the engine named above in the project that runs docture, " +
        "or remove that component from docture.config.ts.",
    );
    expect(run.stderr).not.toContain("corrupt");
  });

  it("does not change the hint for a file an installed engine rejected", async () => {
    const dir = await tempDir("malformed");
    await writeFixture(dir, "broken.pdf", "%PDF-1.7 this is not a document");

    const run = await cli(["inspect", "broken.pdf", "--no-config"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("Every loader failed: pdfjs (");
    expect(run.stderr).toContain("The file could not be read — it may be corrupt, truncated, or password-protected.");
    expect(run.stderr).not.toContain("Install the engine");
  });
});
