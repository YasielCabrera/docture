import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SynthRendition } from "@docture/synthetic";
import { renderPdf } from "@docture/synthetic/pdfkit";
import { renderReactPdf } from "@docture/synthetic/react-pdf";
import { afterAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/cli/errors.js";
import { parseRendition, parseSeeds } from "../src/synth/config.js";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";
import { classic, invoiceModel, short } from "./fixtures/synth-invoice.js";
import { reactInvoice } from "./fixtures/synth-react.js";

afterAll(cleanup);

const CREATED_AT = "2025-06-01T00:00:00Z";
const RENDITION_HINT = "Use digital, or a profile and a severity from 0 to 1: scan:0.5, scan-lq:0.5, photo:0.5, fax:0.5.";
const FIXTURE = fileURLToPath(new URL("./fixtures/synth-invoice.ts", import.meta.url));
const REACT_FIXTURE = fileURLToPath(new URL("./fixtures/synth-react.ts", import.meta.url));

async function workspace(extra = ""): Promise<string> {
  const cwd = await tempDir("synth");
  await writeFixture(cwd, "docture.synth.ts", `import { defineSynthConfig } from "@docture/synthetic";
import { classic, invoiceModel, short } from ${JSON.stringify(FIXTURE)};

export default defineSynthConfig({
  model: invoiceModel,
  templates: [classic],
  scenarios: [short],
  createdAt: ${JSON.stringify(CREATED_AT)},
  ${extra}
});
`);
  return cwd;
}

const labelsOf = async (path: string): Promise<{ id: string; rendition: unknown; expected: unknown; labels: { path: string; box: { x: number } }[] }> =>
  JSON.parse(await readFile(path, "utf8"));

describe("docture synth list", () => {
  it("lists templates with family and aliases, scenarios with tags, and renditions", async () => {
    const cwd = await workspace("seeds: [1, 2],");
    const result = await cli(["synth", "list"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "Templates\n" +
        "  classic  invoice  aliases default\n" +
        "Scenarios\n" +
        "  base\n" +
        "  short  edge\n" +
        "Renditions\n" +
        "  profiles    digital, scan:<severity>, scan-lq:<severity>, photo:<severity>, fax:<severity>\n" +
        "  configured  digital\n",
    );
  });
});

describe("docture synth gen", () => {
  it("prints the value the model samples for the seed and scenario", async () => {
    const cwd = await workspace();
    const base = await cli(["synth", "gen", "--seed", "7"], { cwd });
    expect(base.code, base.stderr).toBe(0);
    expect(JSON.parse(base.stdout)).toEqual((await invoiceModel.sample({ seed: 7 })).value);

    const edge = await cli(["synth", "gen", "--seed", "7", "--scenario", "short"], { cwd });
    expect(JSON.parse(edge.stdout)).toEqual((await invoiceModel.sample({ seed: 7, scenario: short })).value);
    expect(JSON.parse(edge.stdout).lineItems).toHaveLength(1);
  });

  it("names the known scenarios when one is unknown", async () => {
    const cwd = await workspace();
    const result = await cli(["synth", "gen", "--seed", "7", "--scenario", "huge"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('error [USAGE] Unknown scenario "huge".\n      The config defines: base, short.\n');
  });
});

describe("docture synth render", () => {
  it("writes the verified digital PDF the API renders, and its expected value and labels", async () => {
    const cwd = await workspace();
    const result = await cli(["synth", "render", "--template", "default", "--seed", "7", "--out", "out/invoice.pdf"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    const document = await renderPdf(classic, await invoiceModel.sample({ seed: 7 }), { createdAt: CREATED_AT });
    expect(result.stderr).toBe(`✓ classic seed 7 base digital → out/invoice.pdf, ${document.labels.length} labels verified\n`);
    expect(Buffer.compare(await readFile(join(cwd, "out/invoice.pdf")), Buffer.from(document.bytes))).toBe(0);
    const written = await labelsOf(join(cwd, "out/invoice.pdf.labels.json"));
    expect(written.id).toBe("classic-base-7-digital");
    expect(written.rendition).toEqual({ kind: "digital" });
    expect(written.expected).toEqual(document.expected);
    expect(written.labels).toEqual(JSON.parse(JSON.stringify(document.labels)));
  });

  it("writes a photo rendition with its labels moved onto the photographed page", async () => {
    const cwd = await workspace();
    const result = await cli(["synth", "render", "--seed", "7", "--rendition", "photo:0.6", "--out", "photo.pdf"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect((await readFile(join(cwd, "photo.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    const photo = await labelsOf(join(cwd, "photo.pdf.labels.json"));
    const digital = await renderPdf(classic, await invoiceModel.sample({ seed: 7 }), { createdAt: CREATED_AT });
    expect(photo.id).toBe("classic-base-7-photo-0.6");
    expect(photo.rendition).toEqual({ kind: "photo", severity: 0.6, dpi: 200 });
    expect(photo.expected).toEqual(digital.expected);
    expect(photo.labels.map((label) => label.path)).toEqual(digital.labels.map((label) => label.path));
    expect(photo.labels[0]?.box.x).not.toBe(digital.labels[0]?.box.x);
  });

  it("rejects a rendition it cannot parse before loading the config", async () => {
    const cwd = await tempDir("synth-empty");
    const result = await cli(["synth", "render", "--seed", "7", "--rendition", "blur:0.3", "--out", "x.pdf"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      'error [USAGE] Unknown rendition "blur:0.3".\n' +
        `      ${RENDITION_HINT}\n`,
    );
  });
});

describe("React templates in docture synth", () => {
  async function mixed(): Promise<string> {
    const cwd = await tempDir("synth-react");
    await writeFixture(cwd, "docture.synth.ts", `import { defineSynthConfig } from "@docture/synthetic";
import { classic, invoiceModel } from ${JSON.stringify(FIXTURE)};
import { reactInvoice } from ${JSON.stringify(REACT_FIXTURE)};

export default defineSynthConfig({ model: invoiceModel, templates: [classic, reactInvoice], createdAt: ${JSON.stringify(CREATED_AT)} });
`);
    return cwd;
  }

  it("renders the React template the API renders, and writes a corpus with both template kinds", async () => {
    const cwd = await mixed();
    const rendered = await cli(["synth", "render", "--template", "react-summary", "--seed", "7", "--out", "react.pdf"], { cwd });
    expect(rendered.code, rendered.stderr).toBe(0);
    const document = await renderReactPdf(reactInvoice, await invoiceModel.sample({ seed: 7 }), { createdAt: CREATED_AT });
    expect(rendered.stderr).toBe("✓ react-summary seed 7 base digital → react.pdf, 3 labels verified\n");
    expect(Buffer.compare(await readFile(join(cwd, "react.pdf")), Buffer.from(document.bytes))).toBe(0);
    expect((await labelsOf(join(cwd, "react.pdf.labels.json"))).labels.map((label) => label.path)).toEqual(["seller.name", "invoiceNumber", "totalCents"]);

    const corpus = await cli(["synth", "corpus", "--seeds", "1", "--out", "corpus"], { cwd });
    expect(corpus.code, corpus.stderr).toBe(0);
    expect((await readdir(join(cwd, "corpus/cases"))).sort()).toEqual(["classic-base-1-digital", "react-summary-base-1-digital"]);
  });
});

describe("docture synth corpus and verify", () => {
  it("writes a corpus, skips every case on a rerun, and verifies the digital cases", async () => {
    const cwd = await workspace("seeds: [1, 2, 3],");
    const first = await cli(["synth", "corpus", "--seeds", "1-2", "--scenarios", "base", "--out", "corpus"], { cwd });
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toBe(`${join(cwd, "corpus", "manifest.jsonl")}\n`);
    expect(first.stderr).toBe("✓ written 2, skipped 0, failed 0.\n");
    expect((await readdir(join(cwd, "corpus/cases"))).sort()).toEqual(["classic-base-1-digital", "classic-base-2-digital"]);

    const rerun = await cli(["synth", "corpus", "--seeds", "1-2", "--scenarios", "base", "--out", "corpus"], { cwd });
    expect(rerun.code, rerun.stderr).toBe(0);
    expect(rerun.stderr).toBe("✓ written 0, skipped 2, failed 0.\n");

    const labels = (await Promise.all(["classic-base-1-digital", "classic-base-2-digital"].map(async (id) => (await labelsOf(join(cwd, "corpus/cases", id, "labels.json"))) as unknown as unknown[]))).flat();
    const verified = await cli(["synth", "verify", "corpus"], { cwd });
    expect(verified.code, verified.stderr).toBe(0);
    expect(verified.stdout).toBe(`2 digital cases verified: ${labels.length} labels.\n`);
  });

  it("fails verification when a label box no longer covers its text", async () => {
    const cwd = await workspace();
    expect((await cli(["synth", "corpus", "--seeds", "4", "--scenarios", "base"], { cwd })).code).toBe(0);
    const path = join(cwd, "corpus/cases/classic-base-4-digital/labels.json");
    const labels = JSON.parse(await readFile(path, "utf8")) as { path: string; box: { x: number; y: number } }[];
    const moved = labels.findIndex((label) => label.path === "invoiceNumber");
    labels[moved] = { ...labels[moved]!, box: { ...labels[moved]!.box, y: 400 } };
    await writeFile(path, JSON.stringify(labels));

    const result = await cli(["synth", "verify", "corpus"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^✗ classic-base-4-digital\n {2}invoiceNumber: "INV-\d{6}" is on page 1, but not inside \[[^\]]+\]\n✗ 1 of 1 digital case failed verification\.\n$/u);
  });

  it("reports a corrupt document as that case's failure and still verifies the others", async () => {
    const cwd = await workspace();
    expect((await cli(["synth", "corpus", "--seeds", "1-2", "--scenarios", "base"], { cwd })).code).toBe(0);
    await writeFile(join(cwd, "corpus/cases/classic-base-1-digital/document.pdf"), "%PDF-1.4 truncated");

    const result = await cli(["synth", "verify", "corpus"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^✗ classic-base-1-digital\n {2}.+\n✗ 1 of 2 digital cases failed verification\.\n$/u);
  });
});

describe("rendition and seed flags", () => {
  it("parses digital and each degradation profile with a severity", () => {
    const parsed: readonly SynthRendition[] = ["digital", "scan:0.3", "scan-lq:0.5", "photo:0.6", "fax:1"].map(parseRendition);
    expect(parsed).toEqual([
      { kind: "digital" },
      { kind: "degrade", profile: "scan", severity: 0.3 },
      { kind: "degrade", profile: "scan-lq", severity: 0.5 },
      { kind: "degrade", profile: "photo", severity: 0.6 },
      { kind: "degrade", profile: "fax", severity: 1 },
    ]);
  });

  it.each([
    ["scan", 'The rendition "scan" needs a severity from 0 to 1 after "scan:".'],
    ["scan:1.5", 'The rendition "scan:1.5" needs a severity from 0 to 1 after "scan:".'],
    ["photo:x", 'The rendition "photo:x" needs a severity from 0 to 1 after "photo:".'],
    ["fax:0.5:1", 'The rendition "fax:0.5:1" needs a severity from 0 to 1 after "fax:".'],
    ["digital:0.5", 'Unknown rendition "digital:0.5".'],
  ])("rejects %s", (text, message) => {
    expect(() => parseRendition(text)).toThrow(new UsageError(message, RENDITION_HINT));
  });

  it("expands ranges and lists in order without repeats, keeping non-numeric seeds as strings", () => {
    expect(parseSeeds("1-3,7,2,smoke")).toEqual([1, 2, 3, 7, "smoke"]);
    expect(() => parseSeeds("5-1")).toThrow(new UsageError('The seed range "5-1" runs backwards.', "Write it as 1-5."));
  });
});
