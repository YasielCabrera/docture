/**
 * `inspect` against a REAL PDF read by the REAL pdf.js loader.
 *
 * No model, no API key, no network — which is exactly the promise the command
 * makes, so the test can make it too. The fixture is generated, so the expected
 * page count and the bytes come from the same call.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeInvoicePdf } from "@docture/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

let cwd: string;

beforeAll(async () => {
  cwd = await tempDir("inspect");
  const digital = await makeInvoicePdf({ seed: 7 });
  const scanned = await makeInvoicePdf({ seed: 7, textless: true });
  await writeFile(join(cwd, "invoice.pdf"), digital.bytes);
  await writeFile(join(cwd, "scan.pdf"), scanned.bytes);
});

afterAll(cleanup);

interface Report {
  readonly file: string;
  readonly loader: string;
  readonly features: {
    readonly mimeType: string;
    readonly pageCount: number;
    readonly hasTextLayer: boolean;
    readonly hasGeometry: boolean;
    readonly hasRenderablePages: boolean;
    readonly form: string;
  };
  readonly pages: readonly { readonly chars: number; readonly lines: number }[];
  readonly text?: string;
}

describe("inspect", () => {
  it("reports what the loader found, with no model wired at all", async () => {
    const run = await cli(["inspect", "invoice.pdf", "--json", "--no-config"], { cwd });

    expect(run.code).toBe(0);
    const report = JSON.parse(run.stdout) as Report;
    expect(report.loader).toBe("pdfjs");
    expect(report.features.mimeType).toBe("application/pdf");
    expect(report.features.hasTextLayer).toBe(true);
    expect(report.features.hasGeometry).toBe(true);
    // No rasterizer composed, so pages cannot be rendered — and that is the fact
    // that explains why a vision strategy would not be a candidate.
    expect(report.features.hasRenderablePages).toBe(false);
    expect(report.features.form).toBe("digital");
    expect(report.pages[0]?.lines ?? 0).toBeGreaterThan(0);
  });

  it("says `scanned` for a PDF with no text layer — the answer to “why did nothing run?”", async () => {
    const run = await cli(["inspect", "scan.pdf", "--json", "--no-config"], { cwd });

    const report = JSON.parse(run.stdout) as Report;
    expect(report.features.hasTextLayer).toBe(false);
    expect(report.features.form).toBe("scanned");
  });

  it("prints a human report naming which requirements hold", async () => {
    const run = await cli(["inspect", "invoice.pdf", "--no-config"], { cwd });

    expect(run.stdout).toContain("invoice.pdf");
    expect(run.stdout).toContain("loader");
    expect(run.stdout).toContain("TEXT_LAYER ✓");
    expect(run.stdout).toContain("RENDERABLE_PAGES ✗");
  });

  it("includes the text under --text and not otherwise", async () => {
    const withText = await cli(["inspect", "invoice.pdf", "--json", "--text", "--no-config"], { cwd });
    const without = await cli(["inspect", "invoice.pdf", "--json", "--no-config"], { cwd });

    expect((JSON.parse(withText.stdout) as Report).text).toContain("Invoice");
    expect((JSON.parse(without.stdout) as Report).text).toBeUndefined();
  });

  it("returns an array for several documents and keeps going past a broken one", async () => {
    await writeFixture(cwd, "broken.pdf", "not a pdf at all");

    const run = await cli(["inspect", "invoice.pdf", "broken.pdf", "--json", "--no-config"], { cwd });

    expect(run.code).toBe(1);
    const reports = JSON.parse(run.stdout) as Report[];
    expect(reports).toHaveLength(1);
    expect(reports[0]?.file).toBe("invoice.pdf");
    expect(run.stderr).toContain("broken.pdf");
  });

  it("takes a file: URL as a document, not as a filename", async () => {
    const run = await cli(
      ["inspect", pathToFileURL(join(cwd, "invoice.pdf")).href, "--json", "--no-config"],
      { cwd: "/" },
    );

    expect(run.code).toBe(0);
    expect((JSON.parse(run.stdout) as Report).file).toBe("invoice.pdf");
  });

  it("emits valid JSON even when every document failed", async () => {
    const dir = await tempDir("inspect-allbad");
    await writeFixture(dir, "broken.pdf", "not a pdf at all");

    const run = await cli(["inspect", "broken.pdf", "--json", "--no-config"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual([]);
  });

  it("says so when a config's built extractor cannot be introspected", async () => {
    const dir = await tempDir("inspect-built");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `import { createExtractor } from "@docture/core";
import { PdfJsLoader } from "@docture/loader-pdfjs";

export default {
  extractor: createExtractor({ loaders: [new PdfJsLoader()], strategies: [] }),
};
`,
    );
    await writeFile(join(dir, "invoice.pdf"), (await makeInvoicePdf({ seed: 3 })).bytes);

    const run = await cli(["inspect", "invoice.pdf", "--json"], { cwd: dir });

    // It still works — the probe needs loaders, not the extractor — but the
    // fallback is stated rather than silently taken.
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("cannot be used here");
    expect((JSON.parse(run.stdout) as Report).loader).toBe("pdfjs");
  });

  it("uses the loaders a config declares", async () => {
    const dir = await tempDir("inspect-config");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `export default {
  loaders: [
    {
      name: "stub",
      capabilities: { text: true, geometry: false, images: false, mimeTypes: ["*/*"] },
      async load() {
        return {
          pages: [{ pageNumber: 1, width: 100, height: 200, text: "hello from the stub loader" }],
          text: "hello from the stub loader",
          form: "digital",
          loader: "stub",
        };
      },
    },
  ],
};
`,
    );
    await writeFixture(dir, "anything.txt", "ignored — the stub answers regardless");

    const run = await cli(["inspect", "anything.txt", "--json"], { cwd: dir });

    const report = JSON.parse(run.stdout) as Report;
    expect(report.loader).toBe("stub");
    expect(report.features.hasGeometry).toBe(false);
  });
});
