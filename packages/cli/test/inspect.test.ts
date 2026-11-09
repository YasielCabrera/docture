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
import { makeInvoicePdf } from "docture/testing/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, cli, tempDir, textLoaderConfig, writeFixture } from "./harness.js";

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
  readonly pages: readonly { readonly pageNumber: number; readonly chars: number; readonly lines: number }[];
  readonly text?: string;
}

describe("inspect", () => {
  it("reports what the loader found, with no model wired at all", async () => {
    const run = await cli(["inspect", "invoice.pdf", "--format", "json", "--no-config"], { cwd });

    expect(run.code).toBe(0);
    const report = JSON.parse(run.stdout).results[0] as Report;
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
    const run = await cli(["inspect", "scan.pdf", "--format", "json", "--no-config"], { cwd });

    const report = JSON.parse(run.stdout).results[0] as Report;
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
    const withText = await cli(["inspect", "invoice.pdf", "--format", "json", "--text", "--no-config"], { cwd });
    const without = await cli(["inspect", "invoice.pdf", "--format", "json", "--no-config"], { cwd });

    expect((JSON.parse(withText.stdout).results[0] as Report).text).toContain("Invoice");
    expect((JSON.parse(without.stdout).results[0] as Report).text).toBeUndefined();
  });

  it("returns envelope items for several documents and keeps going past a broken one", async () => {
    await writeFixture(cwd, "broken.pdf", "not a pdf at all");

    const run = await cli(["inspect", "invoice.pdf", "broken.pdf", "--format", "json", "--no-config"], { cwd });

    expect(run.code).toBe(1);
    const reports = JSON.parse(run.stdout).results as Report[];
    expect(reports).toHaveLength(2);
    expect(reports[1]).toMatchObject({ file: "broken.pdf", ok: false, error: { code: "LOAD_FAILED" } });
    expect(reports[0]?.file).toBe("invoice.pdf");
    expect(run.stderr).toContain("broken.pdf");
  });

  it("takes a file: URL as a document, not as a filename", async () => {
    const run = await cli(
      ["inspect", pathToFileURL(join(cwd, "invoice.pdf")).href, "--format", "json", "--no-config"],
      { cwd: "/" },
    );

    expect(run.code).toBe(0);
    expect((JSON.parse(run.stdout).results[0] as Report).file).toBe("invoice.pdf");
  });

  it("emits valid JSON even when every document failed", async () => {
    const dir = await tempDir("inspect-allbad");
    await writeFixture(dir, "broken.pdf", "not a pdf at all");

    const run = await cli(["inspect", "broken.pdf", "--format", "json", "--no-config"], { cwd: dir });

    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ version: 1, command: "inspect", ok: false, results: [{ file: "broken.pdf", ok: false, error: { code: "LOAD_FAILED" } }] });
  });

  it("says so when a config's built extractor cannot be introspected", async () => {
    const dir = await tempDir("inspect-built");
    await writeFixture(
      dir,
      "docture.config.mjs",
      `import { createExtractor } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

export default {
  extractor: createExtractor({ loaders: [new DocumentLoaderPdfJs()], strategies: [] }),
};
`,
    );
    await writeFile(join(dir, "invoice.pdf"), (await makeInvoicePdf({ seed: 3 })).bytes);

    const run = await cli(["inspect", "invoice.pdf", "--format", "json"], { cwd: dir });

    // It still works — the probe needs loaders, not the extractor — but the
    // fallback is stated rather than silently taken.
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("cannot be used here");
    expect((JSON.parse(run.stdout).results[0] as Report).loader).toBe("pdfjs");
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

    const run = await cli(["inspect", "anything.txt", "--format", "json"], { cwd: dir });

    const report = JSON.parse(run.stdout).results[0] as Report;
    expect(report.loader).toBe("stub");
    expect(report.features.hasGeometry).toBe(false);
  });
});

describe("inspect page selection", () => {
  const reported = async (...flags: string[]) => {
    const dir = await tempDir("inspect-pages");
    await writeFixture(dir, "input.pdf", "%PDF-1.7 test");
    await writeFixture(dir, "docture.config.mjs", textLoaderConfig(["ONE", "TWO", "THREE", "FOUR"], ""));
    const run = await cli(["inspect", "input.pdf", "--format", "json", ...flags], { cwd: dir });
    expect(run.code, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout).results[0] as Report;
    return [report.features.pageCount, report.pages.map((page) => page.pageNumber)];
  };

  it("loads only a listed page set or range", async () => {
    expect(await reported("--pages", "2,4")).toEqual([2, [2, 4]]);
    expect(await reported("--pages", "2-3")).toEqual([2, [2, 3]]);
    expect(await reported("--pages", "3-3")).toEqual([1, [3]]);
  });

  it("keeps a bare --pages n as the first n pages, which --max-pages also selects", async () => {
    expect(await reported("--pages", "2")).toEqual([4, [1, 2]]);
    expect(await reported("--max-pages", "2")).toEqual([4, [1, 2]]);
    expect(await reported("--pages", "2-4", "--max-pages", "1")).toEqual([3, [2]]);
  });

  it("refuses a bare --pages n together with --max-pages", async () => {
    const run = await cli(["inspect", "input.pdf", "--pages", "2", "--max-pages", "1"], { cwd: await tempDir("inspect-pages-conflict") });
    expect([run.code, run.stdout, run.stderr]).toEqual([
      2,
      "",
      "error [USAGE] --pages 2 and --max-pages both limit how many pages are reported.\n" +
        "      Pass --max-pages alone, or a page list such as --pages 2-2 to load that page.\n",
    ]);
  });
});
