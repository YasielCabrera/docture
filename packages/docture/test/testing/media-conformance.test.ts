import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../../", import.meta.url));

function suiteStatuses(): { status: number | null; output: string; states: Map<string, Record<string, string>> } {
  const directory = mkdtempSync(join(tmpdir(), "docture-media-conformance-"));
  try {
    const report = join(directory, "report.json");
    const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "test/testing/fixtures/media.vitest.config.mjs", "--reporter=json", "--outputFile=" + report], { cwd, encoding: "utf8" });
    const rows: { ancestorTitles: string[]; title: string; status: string }[] = JSON.parse(readFileSync(report, "utf8"))
      .testResults.flatMap((suite: { assertionResults: unknown[] }) => suite.assertionResults);
    const states = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const suite = row.ancestorTitles.at(-1)!;
      states.set(suite, { ...states.get(suite), [row.title]: row.status });
    }
    return { status: run.status, output: run.stdout + run.stderr, states };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("conformance suites with non-PDF fixtures", () => {
  const run = suiteStatuses();
  const suite = (name: string) => run.states.get(name) ?? {};
  const failing = (name: string) => Object.entries(suite(name)).filter(([, status]) => status === "failed").map(([title]) => title);
  const skipped = (name: string) => Object.entries(suite(name)).filter(([, status]) => status === "skipped").map(([title]) => title).sort();

  it("passes DocumentLoaderData with plain text, skipping only checks text cannot express", () => {
    expect(failing("loader conformance: text data")).toEqual([]);
    expect(suite("loader conformance: text data")).toMatchObject({
      "loads distinct documents sequentially on one instance": "passed",
      "loads distinct documents concurrently on one instance": "passed",
      "declares itself honestly": "passed",
      "reads a document and finds its content": "passed",
      "spans a long document across pages": "passed",
      "rejects an already-aborted signal instead of doing the work": "passed",
    });
    expect(skipped("loader conformance: text data")).toEqual([
      "gives every page a real size",
      "handles a page with no text without throwing",
      "produces positioned geometry inside the page box",
      "puts the expected text in a line, not just in the page blob",
      "rejects bytes that are not a document of its kind",
      "renders a page to an image on demand",
    ]);
  });

  it("passes an image-only loader with PNG, skipping text and multi-page checks", () => {
    expect(failing("loader conformance: png image")).toEqual([]);
    expect(suite("loader conformance: png image")).toMatchObject({
      "loads distinct documents concurrently on one instance": "passed",
      "gives every page a real size": "passed",
      "renders a page to an image on demand": "passed",
      "rejects bytes that are not a document of its kind": "passed",
    });
    expect(skipped("loader conformance: png image")).toEqual([
      "produces positioned geometry inside the page box",
      "puts the expected text in a line, not just in the page blob",
      "reads a document and finds its content",
      "reports a text document as digital",
      "spans a long document across pages",
    ]);
  });

  it("passes a text-capable OCR loader with PNG, which correctly finds no text lines", () => {
    expect(failing("loader conformance: png ocr")).toEqual([]);
    expect(suite("loader conformance: png ocr")["produces positioned geometry inside the page box"]).toBe("skipped");
  });

  it("fails a text-capable loader that shares one PNG result across loads", () => {
    expect(failing("loader conformance: png ocr contaminates")).toEqual([
      "loads distinct documents sequentially on one instance",
      "loads distinct documents concurrently on one instance",
    ]);
  });

  it("fails a loader that refuses the fixture's media type or shares one result across loads", () => {
    expect(failing("loader conformance: png refused")).toEqual(["declares itself honestly"]);
    expect(failing("loader conformance: png contaminates")).toEqual([
      "loads distinct documents sequentially on one instance",
      "loads distinct documents concurrently on one instance",
    ]);
    expect(run.status, run.output.slice(-2000)).toBe(1);
  });

  it("passes a custom profile for a media type with no shipped profile", () => {
    expect(failing("loader conformance: csv")).toEqual([]);
    expect(suite("loader conformance: csv")["reads a document and finds its content"]).toBe("passed");
  });

  it("checks the selected raster format's signature", () => {
    expect(failing("rasterizer conformance: canvas jpeg")).toEqual([]);
    expect(suite("rasterizer conformance: canvas jpeg")["emits the format it reports"]).toBe("passed");
    expect(failing("rasterizer conformance: jpeg mislabelled")).toEqual(["emits the format it reports"]);
  });
});
