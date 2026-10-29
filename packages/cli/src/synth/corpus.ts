import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FieldLabel } from "@docture/synthetic";
import { writeCorpus, type RenditionSpec } from "@docture/synthetic/node";
import { verifyLabels } from "@docture/synthetic/verify";
import { boolFlag, commaList, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { CliError, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { commonOptions } from "../options.js";
import { corpusDirectory, loadSynthConfig, parseRendition, parseSeeds, scenarioNamed, templatesFor } from "./config.js";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `docture synth corpus`: `writeCorpus` over the config, narrowed or overridden by flags. Exit 1 when any case failed. */
export async function corpusCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });
  const seedsFlag = stringFlag(parsed, "seeds");
  const flagSeeds = seedsFlag === undefined ? undefined : parseSeeds(seedsFlag);
  const flagRenditions = commaList(listFlag(parsed, "renditions")).map(parseRendition);
  const loaded = await loadSynthConfig(io.cwd, stringFlag(parsed, "config"));
  const { config } = loaded;
  // loadSynthConfig checked the shape; a profile object is trusted to be a full degradation profile.
  const renditions = flagRenditions.length > 0 ? flagRenditions : (config.renditions as readonly RenditionSpec[] | undefined);
  const seeds = flagSeeds ?? config.seeds;
  if (seeds === undefined || seeds.length === 0) throw new UsageError("No seeds to render.", "Pass --seeds 1-40, or set seeds in docture.synth.ts.");
  const scenarioNames = commaList(listFlag(parsed, "scenarios"));
  const scenarios = scenarioNames.flatMap((name) => scenarioNamed(config, name) ?? []);
  const directory = corpusDirectory(loaded, stringFlag(parsed, "out"), io.cwd);

  const report = await writeCorpus(directory, {
    model: config.model,
    templates: templatesFor(config, commaList(listFlag(parsed, "templates"))),
    seeds,
    ...(renditions === undefined ? {} : { renditions }),
    ...(scenarioNames.length === 0
      ? config.scenarios === undefined ? {} : { scenarios: config.scenarios }
      : { scenarios, includeBase: scenarioNames.includes("base") }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(config.createdAt === undefined ? {} : { createdAt: config.createdAt }),
    verify: !boolFlag(parsed, "no-verify"),
    signal,
  });

  io.write(`${report.manifest}\n`);
  const counts = `written ${report.written}, skipped ${report.skipped}, failed ${report.failed.length}.`;
  if (report.failed.length === 0) {
    if (!common.quiet) io.diagnostic(`${style.green("✓")} ${counts}\n`);
    return 0;
  }
  io.diagnostic(`${style.red("✗")} ${counts}\n`);
  for (const failure of report.failed) io.diagnostic(`  ${failure.id}: ${failure.message.replaceAll("\n", "\n  ")}\n`);
  return 1;
}

interface CaseRow {
  readonly id: string;
  readonly documents: readonly string[];
  readonly expected: unknown;
  readonly tags: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>>;
}

function parseRow(line: string, number: number, manifest: string): CaseRow {
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    throw new CliError(`Line ${number} of ${manifest} is not JSON.`, "Rewrite the corpus with `docture synth corpus`.");
  }
  const record = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
  const documents = record["documents"];
  if (typeof record["id"] !== "string" || !Array.isArray(documents) || typeof documents[0] !== "string" || typeof record["tags"] !== "object" || record["tags"] === null) {
    throw new CliError(`Line ${number} of ${manifest} is not a synthetic case.`, "Rewrite the corpus with `docture synth corpus`.");
  }
  return row as CaseRow;
}

async function verifyCase(root: string, row: CaseRow): Promise<{ readonly checked: number; readonly failures: readonly string[] }> {
  try {
    const bytes = await readFile(join(root, row.documents[0] as string));
    const labels = JSON.parse(await readFile(join(root, "cases", row.id, "labels.json"), "utf8")) as FieldLabel[];
    const report = await verifyLabels({ bytes, mimeType: "application/pdf", labels, rendition: { kind: "digital" } });
    return { checked: report.checked, failures: report.failures.map((failure) => `${failure.path}: ${failure.message}`) };
  } catch (error) {
    return { checked: 0, failures: [error instanceof Error ? error.message : String(error)] };
  }
}

/** `docture synth verify`: read every digital case the manifest lists back through PDF.js. Exit 1 on any failed label. */
export async function verifyCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const argument = parsed.positionals[0];
  if (argument === undefined) throw new UsageError("Missing <corpus>.", "Run `docture synth verify --help`.");
  const root = resolve(io.cwd, argument);
  const manifest = join(root, "manifest.jsonl");
  const text = await readFile(manifest, "utf8").catch(() => {
    throw new UsageError(`No corpus in ${root}: it has no manifest.jsonl.`, "Pass a directory written by `docture synth corpus`.");
  });
  const rows = text.split("\n").flatMap((line, index) => (line.trim() === "" ? [] : [parseRow(line, index + 1, manifest)]));
  const digital = rows.filter((row) => row.tags["rendition"] === "digital");
  if (digital.length === 0) {
    throw new CliError(`${root} has no digital case to verify.`, "Verification reads the text layer of digital cases; add digital() to the corpus renditions.");
  }

  let labels = 0;
  let failed = 0;
  for (const row of digital) {
    signal.throwIfAborted();
    const result = await verifyCase(root, row);
    labels += result.checked;
    if (result.failures.length === 0) {
      if (common.verbose) io.diagnostic(`${style.green("✓")} ${row.id}\n`);
      continue;
    }
    failed += 1;
    io.diagnostic(`${style.red("✗")} ${row.id}\n`);
    for (const failure of result.failures) io.diagnostic(`  ${failure}\n`);
  }
  if (failed > 0) {
    io.diagnostic(`${style.red("✗")} ${failed} of ${plural(digital.length, "digital case")} failed verification.\n`);
    return 1;
  }
  io.write(`${plural(digital.length, "digital case")} verified: ${plural(labels, "label")}.\n`);
  const degraded = rows.length - digital.length;
  if (degraded > 0 && !common.quiet) io.diagnostic(`${style.dim("·")} Skipped ${plural(degraded, "degraded case")}; they have no text layer.\n`);
  return 0;
}
