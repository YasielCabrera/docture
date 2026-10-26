/**
 * `docture extract` — the headline command.
 *
 * Reads N documents, writes the extracted data to stdout, narrates to stderr.
 * A single bad document never sinks the run: core's `extractBatch` yields failures
 * as values, so one corrupt scan in a batch of 500 loses that one and not the other
 * 499 — and the exit code still says something failed.
 */

import { lstat, mkdir, readlink, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractionResult, Usage } from "docture";
import { boolFlag, choiceFlag, listFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  attemptLines,
  envelope,
  errorRecord,
  OUTPUT_FORMATS,
  reportFailure,
  formatCount,
  formatMs,
  formatUsd,
  recordOf,
  successLine,
  toJson,
  toNdjson,
  type DocumentRecord,
} from "../output.js";
import { resolveSchemaSource } from "../schema.js";
import { buildWiring } from "../wiring.js";

/** Where each document goes when `--out` names a directory. */
function outputPaths(inputs: readonly Input[], out: string, cwd: string): Map<number, string> {
  const paths = new Map<number, string>();
  const taken = new Map<string, string>();

  inputs.forEach((input, index) => {
    const path = resolve(cwd, join(out, `${stem(input.label)}.json`));
    const clash = taken.get(path);
    if (clash !== undefined) {
      // Two inputs with the same basename would overwrite each other, and the
      // survivor would look exactly like a complete run.
      throw new UsageError(
        `"${clash}" and "${input.source}" would both be written to ${path}.`,
        "Rename one, or drop --out and use --format ndjson.",
      );
    }
    taken.set(path, input.source);
    paths.set(index, path);
  });

  return paths;
}

function localPathOf(input: Input): string | undefined {
  if (isAbsolute(input.source)) return input.source;
  if (/^file:/i.test(input.source)) {
    try {
      return fileURLToPath(input.source);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type FileIdentity =
  | { kind: "present"; key: string }
  | { kind: "unresolvable" }
  | { kind: "uninspectable" };

async function identity(path: string): Promise<FileIdentity> {
  try {
    const { dev, ino } = await stat(path, { bigint: true });
    return { kind: "present", key: `${dev}:${ino}` };
  } catch (error) {
    if (error instanceof Error && "code" in error && (
      error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "ELOOP"
    )) {
      return { kind: "unresolvable" };
    }
    return { kind: "uninspectable" };
  }
}

async function refuseInputAliases(inputs: readonly Input[], outputs: readonly string[]): Promise<void> {
  if (outputs.length === 0) return;
  const sources = await Promise.all(inputs.map(async (input) => {
    const path = localPathOf(input);
    return path === undefined ? undefined : { source: input.source, path, identity: await identity(path) };
  }));
  for (const output of outputs) {
    const outputIdentity = await identity(output);
    const source = sources.find((input) => input !== undefined && (
      input.path === output || (outputIdentity.kind === "present" && input.identity.kind === "present"
        && input.identity.key === outputIdentity.key)
    ));
    if (source !== undefined) {
      throw new UsageError(
        `--out target "${output}" would overwrite input "${source.source}".`,
        "Choose a different --out, or omit --out.",
      );
    }
    if (outputIdentity.kind === "uninspectable") {
      throw new UsageError(
        `Cannot inspect --out target "${output}" to verify it does not overwrite a local input.`,
        "Choose a new --out destination, or omit --out.",
      );
    }
    if (outputIdentity.kind === "present") {
      const uninspectable = sources.find((input) => input?.identity.kind === "uninspectable");
      if (uninspectable !== undefined) {
        throw new UsageError(
          `Cannot verify --out target "${output}" against input "${uninspectable.source}" because the input cannot be inspected.`,
          "Choose a new --out destination, or omit --out.",
        );
      }
    }
  }
}

async function missingLeafTarget(rawPath: string): Promise<string | undefined> {
  try {
    await stat(rawPath);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return undefined;
  }

  let current = rawPath;
  const visited = new Set<string>();
  while (true) {
    const leaf = basename(current);
    if (current.endsWith(sep) || leaf === "" || leaf === "." || leaf === "..") return undefined;
    try {
      const parent = dirname(current);
      const parentIdentity = await identity(parent);
      if (parentIdentity.kind !== "present") return undefined;
      const key = `${parentIdentity.key}/${leaf}`;
      let entry: Awaited<ReturnType<typeof lstat>>;
      try {
        entry = await lstat(current);
      } catch (error) {
        return error instanceof Error && "code" in error && error.code === "ENOENT" ? key : undefined;
      }
      if (!entry.isSymbolicLink() || visited.has(key)) return undefined;
      visited.add(key);
      const target = await readlink(current);
      // Keep symlink traversal before any .. segments for the next native lookup.
      current = isAbsolute(target) ? target : `${await realpath(parent)}${sep}${target}`;
    } catch {
      return undefined;
    }
  }
}

async function refuseMissingLeafAliases(inputs: readonly Input[], outputs: readonly string[]): Promise<void> {
  if (outputs.length === 0) return;
  const sources = await Promise.all(inputs.map(async (input) => {
    const path = localPathOf(input);
    return path === undefined ? undefined : { source: input.source, key: await missingLeafTarget(path) };
  }));
  for (const output of outputs) {
    const key = await missingLeafTarget(output);
    if (key === undefined) continue;
    const source = sources.find((input) => input?.key === key);
    if (source !== undefined) {
      throw new UsageError(
        `--out target "${output}" would overwrite input "${source.source}".`,
        "Choose a different --out, or omit --out.",
      );
    }
  }
}

function sumUsage(results: readonly ExtractionResult<unknown>[]): Usage {
  const costs = results.map((r) => r.usage.costUsd).filter((c): c is number => c !== undefined);
  return {
    inputTokens: results.reduce((sum, r) => sum + r.usage.inputTokens, 0),
    outputTokens: results.reduce((sum, r) => sum + r.usage.outputTokens, 0),
    totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
    wallMs: results.reduce((sum, r) => sum + r.usage.wallMs, 0),
    ...(costs.length === 0 ? {} : { costUsd: costs.reduce((sum, c) => sum + c, 0) }),
  };
}

function summaryLine(
  total: number,
  failed: number,
  successes: readonly ExtractionResult<unknown>[],
  style: Style,
): string {
  const usage = sumUsage(successes);
  const parts = [
    `${total} documents`,
    failed === 0 ? style.green("all ok") : style.red(`${failed} failed`),
  ];
  if (usage.totalTokens > 0) parts.push(`${formatCount(usage.totalTokens)} tokens`);
  if (usage.costUsd !== undefined) parts.push(formatUsd(usage.costUsd));
  parts.push(formatMs(usage.wallMs));
  return `${style.dim("─")} ${parts.join(" · ")}\n`;
}

export async function extractCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, "format", OUTPUT_FORMATS) ?? "json";
  const full = boolFlag(parsed, "full");
  const out = stringFlag(parsed, "out");
  const schemaFlag = stringFlag(parsed, "schema");
  const only = listFlag(parsed, "only");
  const concurrencyFlag = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });

  const inputs = await expandInputs(parsed.positionals, io.cwd);

  // `--out` is a file for one document and a directory for many. An explicit
  // trailing slash forces the directory reading even for one.
  const perFile = out !== undefined && (inputs.length > 1 || out.endsWith("/"));
  // Resolve the layout BEFORE the first model call, so a name collision costs
  // nothing rather than everything.
  const targets = perFile && out !== undefined ? outputPaths(inputs, out, io.cwd) : undefined;
  const outFile = out !== undefined && !perFile ? resolve(io.cwd, out) : undefined;
  const outputs = targets ? [...targets.values()] : outFile ? [outFile] : [];
  await refuseInputAliases(inputs, outputs);
  if (perFile) {
    for (const parent of new Set(outputs.map((path) => dirname(path)))) {
      await mkdir(parent, { recursive: true });
    }
    await refuseInputAliases(inputs, outputs);
  }
  await refuseMissingLeafAliases(inputs, outputs);

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const schemaSource = await resolveSchemaSource({
    ...(schemaFlag === undefined ? {} : { specifier: schemaFlag }),
    ...(config?.config.schema === undefined ? {} : { fromConfig: config.config.schema }),
    cwd: io.cwd,
    command: "extract",
  });

  const wiring = await buildWiring({
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
    needsModel: true,
  });

  if (!common.quiet) {
    if (common.verbose) {
      for (const note of [...wiring.notes, schemaSource.describe]) {
        io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
      }
    }
    for (const warning of [...wiring.warnings, ...schemaSource.warnings]) {
      io.diagnostic(`${style.yellow("!")} ${warning}\n`);
    }
  }

  /**
   * Stream to stdout — unless `--out` is taking it. Three cases, and only one of
   * them writes to the terminal: no `--out` at all; one `--out` file collecting
   * the whole run; a directory, where each document is written as it finishes and
   * this sink is silent.
   */
  let collected = "";
  const emit = (chunk: string): void => {
    if (perFile) return;
    if (out === undefined) io.write(chunk);
    else collected += chunk;
  };

  const records = new Array<DocumentRecord | undefined>(inputs.length);
  const successes: ExtractionResult<unknown>[] = [];
  const hintsShown = new Set<string>();
  let failed = 0;

  try {
    const batch = wiring.extractor.extractBatch(
      inputs.map((input) => input.source),
      schemaSource.schema,
      {
        signal,
        concurrency: concurrencyFlag ?? wiring.concurrency,
        ...(only.length === 0 ? {} : { only }),
      },
    );

    for await (const item of batch) {
      const label = inputs[item.index]?.label ?? String(item.index);

      if (item.outcome.ok) {
        const result = item.outcome.result;
        successes.push(result);
        const record = recordOf(label, result, full);
        records[item.index] = record;

        if (!common.quiet) {
          io.diagnostic(successLine(label, result, style));
          if (common.verbose) io.diagnostic(attemptLines(result.attempts, style));
        }
        if (format === "ndjson") emit(toNdjson(record));
        if (format === "text") emit(`${label}\n${toJson(result.data)}`);
        const path = targets?.get(item.index);
        if (path !== undefined) await writeJson(path, record);
      } else {
        failed += 1;
        const error = item.outcome.error;
        const explained = explain(error);
        const record = errorRecord(label, explained);
        records[item.index] = record;

        reportFailure(io, label, explained, style, hintsShown);
        if (format === "ndjson") emit(toNdjson(record));
        const path = targets?.get(item.index);
        if (path !== undefined) await writeJson(path, record);
      }
    }
  } finally {
    await wiring.dispose();
  }

  if (format === "json") {
    const ordered = records.filter((record): record is DocumentRecord => record !== undefined);
    emit(toJson(envelope("extract", ordered)));
  }

  if (outFile !== undefined && collected.length > 0) {
    await writeFile(outFile, collected, "utf8");
  }

  if (!common.quiet) {
    if (inputs.length > 1) io.diagnostic(summaryLine(inputs.length, failed, successes, style));
    if (out !== undefined && (collected.length > 0 || perFile)) {
      io.diagnostic(`${style.dim("→")} written to ${out}\n`);
    }
  }

  return failed === 0 ? 0 : 1;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(payload), "utf8");
}
