import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { degrade, type Profile, type ProfileKey } from "../degrade/index.js";
import { caseIdOf, toEvalCase, type Rendition, type SyntheticDocument } from "../document.js";
import type { Model, Sample, Scenario } from "../model.js";
import { renderPdf } from "../pdfkit/index.js";
import type { TagValue, Template } from "../template.js";
import { assertVerified } from "../verify/index.js";

/** One way to present each rendering: the digital PDF, or a degradation of it. */
export type RenditionSpec =
  | { readonly kind: "digital" }
  | {
      readonly kind: "degrade";
      readonly profile: ProfileKey | Profile;
      readonly severity: number;
      readonly dpi?: number;
      readonly output?: "pdf" | "png" | "jpeg";
    };

interface DegradeLevel {
  readonly severity: number;
  readonly dpi?: number;
}

const degraded =
  (profile: ProfileKey) =>
  (options: DegradeLevel): RenditionSpec => ({ kind: "degrade", profile, ...options });

export const digital = (): RenditionSpec => ({ kind: "digital" });
export const scan = degraded("scan");
export const scanLq = degraded("scan-lq");
export const photo = degraded("photo");
export const fax = degraded("fax");

export interface CorpusPlan<T> {
  readonly model: Model<T>;
  readonly templates: readonly Template<T>[];
  readonly seeds: readonly (number | string)[];
  readonly scenarios?: readonly Scenario<T>[];
  /** Include unvaried samples as scenario `base`. Default `true`. */
  readonly includeBase?: boolean;
  /** Default `[digital()]`. */
  readonly renditions?: readonly RenditionSpec[];
  /** Renderings in flight at once. Default 4. */
  readonly concurrency?: number;
  /** Verify each digital rendering before writing it; a failure fails that rendering's cases, not the batch. Default `true`. */
  readonly verify?: boolean;
  /** Written into every PDF; part of each case key. */
  readonly createdAt?: string;
  readonly signal?: AbortSignal;
}

export interface CorpusReport {
  readonly written: number;
  readonly skipped: number;
  readonly failed: readonly { readonly id: string; readonly message: string }[];
  /** Absolute path of `manifest.jsonl`. */
  readonly manifest: string;
}

/** One `manifest.jsonl` line, `@docture/eval`'s `jsonlDataset` row. */
interface ManifestRow {
  readonly id: string;
  readonly documents: readonly string[];
  readonly expected: unknown;
  readonly tags: Readonly<Record<string, TagValue>>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly group: string;
  readonly locations: unknown;
}

interface PlannedCase {
  readonly id: string;
  readonly spec: RenditionSpec;
  readonly rendition: Rendition;
  readonly key: string;
}

/** A case on disk: its manifest row and the SHA-256 of each file by name. */
interface StoredCase {
  readonly row: ManifestRow;
  readonly files: Readonly<Record<string, string>>;
}

/** One sample drawn with one template, rendered once; each rendition is a case. */
interface Rendering<T> {
  readonly seed: number | string;
  readonly scenario: Scenario<T> | undefined;
  readonly template: Template<T>;
  readonly cases: readonly PlannedCase[];
}

type CaseOutcome =
  | { readonly kind: "written" | "skipped"; readonly row: ManifestRow; readonly files: Readonly<Record<string, string>> }
  | { readonly kind: "failed"; readonly id: string; readonly message: string };

const CASE_ROW = "case.json";
const KEY_FILE = ".key";
const EXTENSIONS: Readonly<Record<string, string>> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
const ENGINES = ["docture", "pdfkit", "pdfjs-dist", "@napi-rs/canvas", "sharp"] as const;

/**
 * Render every seed, scenario and template once, derive each rendition, and write a corpus that
 * `@docture/eval`'s `jsonlDataset` reads. Rerunning converges: a case whose key and files match is
 * skipped, and each case lands by renaming a finished temporary folder into place.
 */
export async function writeCorpus<T>(directory: string, plan: CorpusPlan<T>): Promise<CorpusReport> {
  const root = resolve(directory);
  const cases = join(root, "cases");
  const staging = join(root, ".tmp");
  const version = await packageVersion();
  await rm(staging, { recursive: true, force: true });
  await mkdir(cases, { recursive: true });
  await mkdir(staging, { recursive: true });

  const engines = Object.fromEntries(await Promise.all(ENGINES.map(async (name) => [name, await engineVersion(name)] as const)));
  const renderings = planRenderings(plan, version, engines);
  const outcomes = (
    await pool(renderings, plan.concurrency ?? 4, plan.signal, (rendering) => writeRendering(rendering, plan, { cases, staging }))
  ).flat();

  const rows = outcomes.flatMap((outcome) => (outcome.kind === "failed" ? [] : [outcome.row]));
  const failed = outcomes.flatMap((outcome) => (outcome.kind === "failed" ? [{ id: outcome.id, message: outcome.message }] : []));
  const files: Record<string, string> = {};
  for (const outcome of outcomes) if (outcome.kind !== "failed") Object.assign(files, outcome.files);
  const top = {
    "manifest.jsonl": jsonl(rows),
    "coverage.json": json(coverageOf(rows)),
    "failures.jsonl": jsonl(failed),
  };
  for (const [name, text] of Object.entries(top)) {
    await writeAtomic(join(root, name), join(staging, name), text);
    files[name] = sha256(text);
  }
  const summary = {
    generator: { name: "@docture/synthetic", version },
    plan: {
      templates: plan.templates.map((template) => template.key),
      seeds: plan.seeds,
      scenarios: plan.scenarios?.map((item) => item.name) ?? [],
      includeBase: plan.includeBase ?? true,
      renditions: (plan.renditions ?? [digital()]).map(describeSpec),
      verify: plan.verify ?? true,
      createdAt: plan.createdAt ?? null,
    },
    counts: { cases: rows.length, failed: failed.length },
    engines,
    node: process.version,
    files: sortedByKey(files),
  };
  await writeAtomic(join(root, "corpus.json"), join(staging, "corpus.json"), json(summary));
  await rm(staging, { recursive: true, force: true });
  return {
    written: outcomes.filter((outcome) => outcome.kind === "written").length,
    skipped: outcomes.filter((outcome) => outcome.kind === "skipped").length,
    failed,
    manifest: join(root, "manifest.jsonl"),
  };
}

function planRenderings<T>(plan: CorpusPlan<T>, version: string, engines: Readonly<Record<string, string | null>>): Rendering<T>[] {
  const scenarios = [...((plan.includeBase ?? true) ? [undefined] : []), ...(plan.scenarios ?? [])];
  const specs = plan.renditions ?? [digital()];
  const renderings: Rendering<T>[] = [];
  for (const seed of plan.seeds) {
    for (const scenario of scenarios) {
      const scenarioName = scenario?.name ?? "base";
      for (const template of plan.templates) {
        const cases = specs.map((spec): PlannedCase => {
          const rendition = renditionOf(spec);
          const inputs = {
            seed,
            scenario: scenarioName,
            template: template.key,
            rendition: spec,
            createdAt: plan.createdAt ?? null,
            verify: plan.verify ?? true,
            version,
            engines,
            source: fingerprint([plan.model.schema, plan.model.options, template, scenario ?? null]),
          };
          return { id: caseIdOf({ sample: { seed, scenario: scenarioName }, template, rendition }), spec, rendition, key: sha256(JSON.stringify(inputs)) };
        });
        renderings.push({ seed, scenario, template, cases });
      }
    }
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of renderings.flatMap((rendering) => rendering.cases)) (seen.has(id) ? duplicates : seen).add(id);
  if (duplicates.size > 0) {
    throw new RangeError(`The corpus plan produces duplicate case ids: ${[...duplicates].join(", ")}. Remove repeated seeds, scenarios, templates or renditions.`);
  }
  return renderings;
}

function renditionOf(spec: RenditionSpec): Rendition {
  if (spec.kind === "digital") return { kind: "digital" };
  return {
    kind: typeof spec.profile === "string" ? spec.profile : spec.profile.key,
    severity: spec.severity,
    dpi: spec.dpi ?? 200,
    ...(spec.output === undefined || spec.output === "pdf" ? {} : { output: spec.output }),
  };
}

function describeSpec(spec: RenditionSpec): unknown {
  if (spec.kind === "digital") return spec;
  return { ...spec, profile: typeof spec.profile === "string" ? spec.profile : spec.profile.key };
}

async function writeRendering<T>(
  rendering: Rendering<T>,
  plan: CorpusPlan<T>,
  folders: { readonly cases: string; readonly staging: string },
): Promise<CaseOutcome[]> {
  const states = await Promise.all(rendering.cases.map(async (item) => ({ item, found: await readFresh(join(folders.cases, item.id), item.key) })));
  const skipped = (item: PlannedCase, found: StoredCase): CaseOutcome => ({ kind: "skipped", row: found.row, files: prefixed(item.id, found.files) });
  if (states.every((state): state is { item: PlannedCase; found: StoredCase } => state.found !== undefined)) {
    return states.map(({ item, found }) => skipped(item, found));
  }
  let sample: Sample<T>;
  let document: SyntheticDocument;
  try {
    sample = await plan.model.sample({ seed: rendering.seed, ...(rendering.scenario === undefined ? {} : { scenario: rendering.scenario }) });
    document = await renderPdf(rendering.template, sample, plan.createdAt === undefined ? {} : { createdAt: plan.createdAt });
    if (plan.verify ?? true) await assertVerified(document);
  } catch (error) {
    for (const item of rendering.cases) await rm(join(folders.cases, item.id), { recursive: true, force: true });
    return rendering.cases.map((item) => ({ kind: "failed", id: item.id, message: messageOf(error) }));
  }
  const outcomes: CaseOutcome[] = [];
  for (const { item, found } of states) {
    if (found !== undefined) {
      outcomes.push(skipped(item, found));
      continue;
    }
    try {
      const output =
        item.spec.kind === "digital"
          ? document
          : await degrade(document, {
              profile: item.spec.profile,
              severity: item.spec.severity,
              ...(item.spec.dpi === undefined ? {} : { dpi: item.spec.dpi }),
              ...(item.spec.output === undefined ? {} : { output: item.spec.output }),
            });
      const stored = await writeCase(folders, item, output, sample);
      outcomes.push({ kind: "written", row: stored.row, files: prefixed(item.id, stored.files) });
    } catch (error) {
      await rm(join(folders.cases, item.id), { recursive: true, force: true });
      outcomes.push({ kind: "failed", id: item.id, message: messageOf(error) });
    }
  }
  return outcomes;
}

async function writeCase(
  folders: { readonly cases: string; readonly staging: string },
  item: PlannedCase,
  document: SyntheticDocument,
  sample: Sample<unknown>,
): Promise<StoredCase> {
  const evalCase = toEvalCase(document, { id: item.id });
  const documentName = `document.${EXTENSIONS[document.mimeType] ?? "bin"}`;
  const row: ManifestRow = {
    id: item.id,
    documents: [`cases/${item.id}/${documentName}`],
    expected: evalCase.expected,
    tags: evalCase.tags,
    params: evalCase.params,
    group: evalCase.group,
    locations: evalCase.locations,
  };
  const contents: Record<string, Uint8Array | string> = {
    [documentName]: document.bytes,
    "expected.json": json(document.expected),
    "labels.json": json(document.labels),
    "sample.json": json({ seed: sample.seed, scenario: sample.scenario, value: sample.value }),
    [CASE_ROW]: json(row),
  };
  const files = Object.fromEntries(Object.entries(contents).map(([name, content]) => [name, sha256(content)]));
  const temporary = join(folders.staging, item.id);
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  for (const [name, content] of Object.entries(contents)) await writeFile(join(temporary, name), content);
  await writeFile(join(temporary, KEY_FILE), keyFile(item.key, files));
  const target = join(folders.cases, item.id);
  await rm(target, { recursive: true, force: true });
  await rename(temporary, target);
  return { row, files };
}

/** The key, then one `sha256  name` line per file, sorted by name. */
function keyFile(key: string, files: Readonly<Record<string, string>>): string {
  return [key, ...Object.keys(files).sort().map((name) => `${files[name]}  ${name}`)].join("\n") + "\n";
}

/** The case's stored row and file hashes when its key matches and every listed file is intact. */
async function readFresh(folder: string, key: string): Promise<StoredCase | undefined> {
  let text: string;
  try {
    text = await readFile(join(folder, KEY_FILE), "utf8");
  } catch {
    return undefined;
  }
  const [storedKey, ...lines] = text.trimEnd().split("\n");
  if (storedKey !== key) return undefined;
  const files: Record<string, string> = {};
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    if (match === null) return undefined;
    files[match[2] as string] = match[1] as string;
  }
  const present = (await readdir(folder)).filter((name) => name !== KEY_FILE).sort();
  if (present.join("\n") !== Object.keys(files).sort().join("\n") || !(CASE_ROW in files)) return undefined;
  for (const [name, hash] of Object.entries(files)) if (sha256(await readFile(join(folder, name))) !== hash) return undefined;
  return { row: JSON.parse(await readFile(join(folder, CASE_ROW), "utf8")) as ManifestRow, files };
}

function prefixed(id: string, files: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, hash]) => [`cases/${id}/${name}`, hash]));
}

function coverageOf(rows: readonly ManifestRow[]): Record<string, Record<string, number>> {
  const coverage: Record<string, Record<string, number>> = { scenario: {}, template: {}, family: {}, rendition: {}, severity: {} };
  for (const row of rows) {
    for (const dimension of Object.keys(coverage)) {
      const value = row.tags[dimension];
      if (value === undefined) continue;
      const counts = coverage[dimension] as Record<string, number>;
      counts[String(value)] = (counts[String(value)] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(coverage).map(([dimension, counts]) => [dimension, sortedByKey(counts)]));
}

/** Run `work` over `items` with at most `limit` in flight, keeping results in item order. */
async function pool<I, O>(items: readonly I[], limit: number, signal: AbortSignal | undefined, work: (item: I) => Promise<O>): Promise<O[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`concurrency must be a positive integer, got ${limit}`);
  const results: O[] = new Array(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await work(items[index] as I);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

async function writeAtomic(target: string, temporary: string, text: string): Promise<void> {
  await writeFile(temporary, text);
  await rename(temporary, target);
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

/** The installed version of `name`, found from its resolved entry, or `null` when it is not installed. */
async function engineVersion(name: string): Promise<string | null> {
  let directory: string;
  try {
    directory = dirname(fileURLToPath(import.meta.resolve(name)));
  } catch {
    return null;
  }
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: string; version?: string };
      if (manifest.name === name) return manifest.version ?? null;
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

const sortedByKey = <V>(record: Readonly<Record<string, V>>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const sha256 = (content: Uint8Array | string): string => createHash("sha256").update(content).digest("hex");
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const jsonl = (rows: readonly unknown[]): string => rows.map((row) => JSON.stringify(row) + "\n").join("");
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A hash of the model schema, template and scenario, functions included by their source text, so editing a
 * template's drawing code or a scenario invalidates its cases. Values a function captures from outside are not seen.
 */
function fingerprint(value: unknown): string {
  return sha256(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "function" ? `fn:${String(item)}` : item instanceof Uint8Array ? `bytes:${sha256(item)}` : item,
    ),
  );
}
