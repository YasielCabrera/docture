import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { looseEval } from "@docture/eval";
import { groundingSection } from "@docture/eval/grounding";
import { jsonlDataset } from "@docture/eval/node";
import { runEval } from "@docture/eval/runner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineTemplate, gen, locales, locationsOf, scenario, type FieldLabel } from "../src/index.js";
import { digital, scan, writeCorpus, type CorpusPlan } from "../src/node/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";
import { classic } from "./templates.js";

const overflowing = defineTemplate<Invoice>()({
  key: "overflowing",
  family: "invoice",
  locale: locales["de-DE"],
  printed: {
    invoiceNumber: true,
    issuedAt: false,
    dueAt: false,
    currency: false,
    seller: false,
    buyer: false,
    paymentMethod: false,
    lineItems: false,
    subtotalCents: false,
    taxCents: false,
    totalCents: false,
    note: false,
  },
  draw(page, value) {
    page.field("invoiceNumber", `Rechnungsnummer ${value.invoiceNumber} für alle Leistungen im Abrechnungszeitraum`, { x: 560, y: 50 });
  },
});

const short = scenario<Invoice>({ name: "short", tags: ["edge"], fields: { lineItems: gen.array({ length: 1 }) } });
const plan: CorpusPlan<Invoice> = {
  model: invoiceModel,
  templates: [classic],
  seeds: [1, 2],
  scenarios: [short],
  renditions: [digital(), scan({ severity: 0.3 })],
  createdAt: "2025-06-01T00:00:00Z",
};
const IDS = [
  "classic-base-1-digital",
  "classic-base-1-scan-0.3",
  "classic-short-1-digital",
  "classic-short-1-scan-0.3",
  "classic-base-2-digital",
  "classic-base-2-scan-0.3",
  "classic-short-2-digital",
  "classic-short-2-scan-0.3",
];
const CASE_FILES = [".key", "case.json", "document.pdf", "expected.json", "labels.json", "sample.json"];

const dirs: string[] = [];
async function temporary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docture-synthetic-corpus-"));
  dirs.push(dir);
  return dir;
}

/** Every file under `root` with the SHA-256 of its bytes, by relative path. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(root, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

let reference: string;
let referenceFiles: Record<string, string>;

beforeAll(async () => {
  reference = await temporary();
  const report = await writeCorpus(reference, plan);
  expect(report).toEqual({ written: 8, skipped: 0, failed: [], manifest: join(reference, "manifest.jsonl") });
  referenceFiles = await snapshot(reference);
}, 120_000);
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeCorpus", () => {
  it("writes one folder per case and the corpus files, rows in plan order", async () => {
    expect(Object.keys(referenceFiles)).toEqual(
      [
        ...IDS.flatMap((id) => CASE_FILES.map((name) => `cases/${id}/${name}`)),
        "corpus.json",
        "coverage.json",
        "failures.jsonl",
        "manifest.jsonl",
      ].sort(),
    );
    const rows = (await readFile(join(reference, "manifest.jsonl"), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows.map((row) => row.id)).toEqual(IDS);
    expect(rows[1]).toMatchObject({
      documents: ["cases/classic-base-1-scan-0.3/document.pdf"],
      tags: { template: "classic", family: "invoice", scenario: "base", rendition: "scan", severity: "mild", columns: 1, locale: "de-DE" },
      params: { seed: 1, scenarioTags: [], kind: "scan", severity: 0.3 },
      group: "1:base:classic",
    });
    expect(await readFile(join(reference, "failures.jsonl"), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(reference, "coverage.json"), "utf8"))).toEqual({
      scenario: { base: 4, short: 4 },
      template: { classic: 8 },
      family: { invoice: 8 },
      rendition: { digital: 4, scan: 4 },
      severity: { mild: 4 },
    });
    const corpus = JSON.parse(await readFile(join(reference, "corpus.json"), "utf8")) as Record<string, unknown>;
    expect(corpus).toMatchObject({
      generator: { name: "@docture/synthetic", version: "0.2.0" },
      plan: {
        templates: ["classic"],
        seeds: [1, 2],
        scenarios: ["short"],
        includeBase: true,
        renditions: [{ kind: "digital" }, { kind: "degrade", profile: "scan", severity: 0.3 }],
        verify: true,
        createdAt: "2025-06-01T00:00:00Z",
      },
      counts: { cases: 8, failed: 0 },
      engines: { pdfkit: "0.19.1", "pdfjs-dist": "6.2.108", "@napi-rs/canvas": "1.0.10", sharp: "0.35.5" },
      node: process.version,
    });
    const { ["corpus.json"]: _, ...hashed } = referenceFiles;
    const listed = Object.fromEntries(Object.entries(hashed).filter(([path]) => !path.endsWith("/.key")));
    expect(corpus.files).toEqual(listed);
    expect(JSON.parse(await readFile(join(reference, "cases/classic-short-2-digital/sample.json"), "utf8"))).toMatchObject({ seed: 2, scenario: "short" });
  });

  it("skips every case on a rerun and leaves every file byte-identical", async () => {
    const copy = await temporary();
    await cp(reference, copy, { recursive: true });
    const report = await writeCorpus(copy, plan);
    expect(report).toEqual({ written: 0, skipped: 8, failed: [], manifest: join(copy, "manifest.jsonl") });
    expect(await snapshot(copy)).toEqual(referenceFiles);
  });

  it("writes the same bytes one rendering at a time as with the default pool", async () => {
    const dir = await temporary();
    expect(await writeCorpus(dir, { ...plan, concurrency: 1 })).toMatchObject({ written: 8, skipped: 0 });
    expect(await snapshot(dir)).toEqual(referenceFiles);
  });

  it("rewrites exactly a deleted case and clears a stale temporary folder, matching an uninterrupted run", async () => {
    const copy = await temporary();
    await cp(reference, copy, { recursive: true });
    await rm(join(copy, "cases/classic-short-1-scan-0.3"), { recursive: true });
    await mkdir(join(copy, ".tmp/classic-short-1-scan-0.3"), { recursive: true });
    await writeFile(join(copy, ".tmp/classic-short-1-scan-0.3/document.pdf"), "partial");
    const report = await writeCorpus(copy, plan);
    expect(report).toEqual({ written: 1, skipped: 7, failed: [], manifest: join(copy, "manifest.jsonl") });
    expect(await snapshot(copy)).toEqual(referenceFiles);
  });

  it("rewrites a case whose files no longer match its key", async () => {
    const copy = await temporary();
    await cp(reference, copy, { recursive: true });
    await writeFile(join(copy, "cases/classic-base-2-digital/expected.json"), "{}\n");
    expect(await writeCorpus(copy, plan)).toMatchObject({ written: 1, skipped: 7 });
    expect(await snapshot(copy)).toEqual(referenceFiles);
  });

  it("records a template that fails verification in failures.jsonl and writes the rest", async () => {
    const dir = await temporary();
    const report = await writeCorpus(dir, { ...plan, templates: [classic, overflowing], scenarios: [], renditions: [digital()] });
    expect(report.written).toBe(2);
    expect(report.failed.map((failure) => failure.id)).toEqual(["overflowing-base-1-digital", "overflowing-base-2-digital"]);
    expect(report.failed[0]?.message).toMatch(/^Label verification failed:\n {2}- invoiceNumber: box \[560, 50, [\d.]+ × [\d.]+\] leaves the 595\.28 × 841\.89 page$/u);
    const failures = (await readFile(join(dir, "failures.jsonl"), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as unknown);
    expect(failures).toEqual(report.failed);
    expect(await readdir(join(dir, "cases"))).toEqual(["classic-base-1-digital", "classic-base-2-digital"]);
    const manifest = (await readFile(report.manifest, "utf8")).trimEnd().split("\n").map((line) => (JSON.parse(line) as { id: string }).id);
    expect(manifest).toEqual(["classic-base-1-digital", "classic-base-2-digital"]);
  });

  it("produces a manifest that @docture/eval loads with locations and scores perfectly against its own truth", async () => {
    const cases = await jsonlDataset(join(reference, "manifest.jsonl")).cases();
    expect(cases.map((item) => item.id)).toEqual(IDS);
    let labelled = 0;
    for (const item of cases) {
      const labels = JSON.parse(await readFile(join(reference, "cases", item.id, "labels.json"), "utf8")) as FieldLabel[];
      expect(labels.length).toBeGreaterThan(10);
      labelled += labels.length;
      expect(item.locations).toEqual(locationsOf(labels));
      expect(item.documents[0]?.hash).toBe(referenceFiles[`cases/${item.id}/document.pdf`]);
    }
    const result = await runEval({
      dataset: jsonlDataset(join(reference, "manifest.jsonl")),
      spec: looseEval(),
      experiments: {
        id: "oracle",
        async extract(item) {
          const evidence = Object.entries(item.locations ?? {}).flatMap(([path, places]) => places.map((place) => ({ path, ...place })));
          return { raw: item.expected, evidence };
        },
      },
      sections: [groundingSection()],
    });
    expect(result.summary.oracle?.cases).toEqual({ total: 8, scored: 8, errored: 0, skipped: 0 });
    expect(result.summary.oracle?.overall).toMatchObject({ exactRate: 1, f1: 1 });
    expect(result.grounding?.experiments.oracle?.overall).toMatchObject({ labelled, grounded: labelled, hallucinated: 0, groundedF1: 1 });
  });
});
