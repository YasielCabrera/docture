import { GroundTruthError, type Dataset, type InvalidCaseTruth, type WritableDataset } from "@docture/eval";
import { draftExpected, runMigration, sample, type Migration } from "@docture/eval/dataset";
import { boolFlag, commaList, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { loadExport } from "../load-module.js";
import { commonOptions } from "../options.js";
import { experimentsOf, loadEvalConfig, selectExperiments, valueAt } from "./config.js";

const configOf = async (parsed: Parsed, io: Io) => (await loadEvalConfig(io.cwd, stringFlag(parsed, "config"))).config;

function writable<T>(dataset: Dataset<T>, action: string): WritableDataset<T> {
  const candidate = dataset as Partial<WritableDataset<T>>;
  if (typeof candidate.writeExpected !== "function" || typeof candidate.signOff !== "function") {
    throw new UsageError(
      `The dataset ${dataset.id} cannot ${action}: it has no writeExpected() and signOff().`,
      "Use a writable dataset such as folderDataset, or add both methods to your adapter.",
    );
  }
  return dataset as WritableDataset<T>;
}

const display = (value: unknown): string => (value === undefined ? "(absent)" : JSON.stringify(value));

/** `docture eval validate`: every case's truth against the spec, all problems in one error. */
export async function validateCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const config = await configOf(parsed, io);
  const cases = await config.dataset.cases();
  const seen = new Set<string>();
  const duplicates = cases.filter((item) => seen.size === seen.add(item.id).size).map((item) => item.id);
  if (duplicates.length > 0) throw new UsageError(`The dataset ${config.dataset.id} repeats case ids: ${[...new Set(duplicates)].join(", ")}.`);
  const invalid: InvalidCaseTruth[] = [];
  for (const item of cases) {
    const verdict = config.spec.validate(item.expected);
    if (!verdict.ok) invalid.push({ caseId: item.id, issues: verdict.issues });
  }
  if (invalid.length > 0) throw new GroundTruthError(invalid);
  const drafts = cases.filter((item) => item.status === "draft").map((item) => item.id);
  io.write(`${cases.length} case${cases.length === 1 ? "" : "s"} of ${config.dataset.id} satisfy the spec.\n`);
  if (drafts.length > 0 && !common.quiet) io.diagnostic(`${style.yellow("!")} Not signed off yet: ${drafts.join(", ")}.\n`);
  return 0;
}

/** `docture eval sample`: the ids of a deterministic stratified sample, one per line. */
export async function sampleCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const size = numberFlag(parsed, "size", { min: 0, integer: true });
  if (size === undefined) throw new UsageError("Missing --size <n>.", "Run `docture eval sample --help`.");
  const strata = stringFlag(parsed, "strata");
  const seed = stringFlag(parsed, "seed");
  const config = await configOf(parsed, io);
  const chosen = sample(await config.dataset.cases(), {
    size,
    ...(strata === undefined ? {} : { strata: (item: unknown) => valueAt(item, strata) }),
    ...(seed === undefined ? {} : { seed }),
  });
  for (const item of chosen) io.write(`${item.id}\n`);
  return 0;
}

/** `docture eval migrate`: preview a ground-truth migration, or write it with `--write`. */
export async function migrateCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const specifier = parsed.positionals[0];
  if (specifier === undefined) throw new UsageError("Missing <migration>.", "Run `docture eval migrate --help`.");
  const write = boolFlag(parsed, "write");
  const config = await configOf(parsed, io);
  const migration = (await loadExport<Migration<unknown>>(specifier, { kind: "migration", cwd: io.cwd, names: ["migration"] })).value;
  if (typeof migration !== "object" || migration === null || typeof migration.apply !== "function" || !Array.isArray(migration.targets)) {
    throw new UsageError(`"${specifier}" does not export a migration.`, "Export defineMigration({ id, description, targets, apply }).");
  }
  const dataset = write ? writable(config.dataset, "write a migration") : {
    id: config.dataset.id,
    cases: (options?: { readonly signal?: AbortSignal }) => config.dataset.cases(options),
    writeExpected: async () => { throw new UsageError("A dry run writes nothing."); },
    signOff: async () => { throw new UsageError("A dry run writes nothing."); },
  };
  const report = await runMigration(dataset, migration, { write, spec: config.spec });
  const changed = report.cases.filter((item) => item.diff.length > 0);
  for (const item of changed) {
    io.write(`${item.caseId}\n`);
    for (const change of item.diff) io.write(`  ${change.path}: ${display(change.before)} → ${display(change.after)}\n`);
  }
  if (!common.quiet) {
    const changes = changed.reduce((sum, item) => sum + item.diff.length, 0);
    io.diagnostic(write
      ? `${style.green("✓")} ${report.migration}: wrote ${changes} change${changes === 1 ? "" : "s"} in ${changed.length} case${changed.length === 1 ? "" : "s"}.\n`
      : `${style.dim("·")} ${report.migration}: ${changes} change${changes === 1 ? "" : "s"} in ${changed.length} case${changed.length === 1 ? "" : "s"}. Dry run; pass --write to apply.\n`);
  }
  return 0;
}

/** `docture eval draft`: extract proposed truth for every case without signed-off truth. */
export async function draftCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const config = await configOf(parsed, io);
  const chosen = Object.entries(selectExperiments(experimentsOf(config), commaList(listFlag(parsed, "experiment"))));
  const [only, ...others] = chosen;
  if (only === undefined || others.length > 0) {
    throw new UsageError("Drafting needs exactly one experiment.", `Pass --experiment with one of: ${chosen.map(([id]) => id).join(", ")}.`);
  }
  const drafted = await draftExpected(writable(config.dataset, "store drafts"), only[1]);
  for (const id of drafted) io.write(`${id}\n`);
  if (!common.quiet) io.diagnostic(`${style.dim("·")} Drafted ${drafted.length} case${drafted.length === 1 ? "" : "s"} with ${only[0]}. Review them, then run docture eval sign-off <id>.\n`);
  return 0;
}

/** `docture eval sign-off`: mark one case's drafted truth as reviewed. */
export async function signOffCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const id = parsed.positionals[0];
  if (id === undefined) throw new UsageError("Missing <case>.", "Run `docture eval sign-off --help`.");
  const config = await configOf(parsed, io);
  await writable(config.dataset, "sign off").signOff(id);
  if (!common.quiet) io.diagnostic(`${style.green("✓")} Signed off ${id}.\n`);
  return 0;
}
