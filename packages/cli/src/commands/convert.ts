/** `docture convert`: grounded PDF conversion with explicit filesystem output. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type ConversionFormat,
  type ConversionResult,
} from "docture";
import { boolFlag, choiceFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { ASSETS, CONVERSION_TARGET, OUTPUT_FORMAT, type CONVERSION_TARGETS } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import { describeInput, expandInputs, stem, type Input } from "../inputs.js";
import { convertInputs } from "../operations.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  attemptLines,
  envelope,
  errorRecord,
  formatMs,
  reportFailure,
  reportWiring,
  toJson,
  toNdjson,
  type Item,
} from "../output.js";
import { emitPlan } from "../plan.js";
import { buildConversionWiring, planConversionWiring, type ConversionWiringInput } from "../wiring.js";


const FORMAT_MAP: Readonly<
  Record<(typeof CONVERSION_TARGETS)[number], { format: ConversionFormat; extension: string }>
> = {
  md: { format: "markdown", extension: ".md" },
  html: { format: "html", extension: ".html" },
  txt: { format: "text", extension: ".txt" },
  json: { format: "json", extension: ".json" },
};

function outputPaths(
  inputs: readonly Input[],
  root: string,
  extension: string,
): Map<number, string> {
  const paths = new Map<number, string>();
  const taken = new Map<string, string>();
  for (const [index, input] of inputs.entries()) {
    const path = resolve(root, `${stem(input.label)}${extension}`);
    const clash = taken.get(path);
    if (clash !== undefined) {
      throw new UsageError(
        `"${clash}" and "${describeInput(input)}" would both be written to ${path}.`,
        "Rename one input before converting the batch.",
      );
    }
    taken.set(path, describeInput(input));
    paths.set(index, path);
  }
  return paths;
}

function within(root: string, reference: string): string {
  const path = resolve(root, reference);
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new UsageError(`Asset reference "${reference}" escapes the output directory.`);
  }
  return path;
}

function successLine(label: string, result: ConversionResult): string {
  const failures = result.attempts.filter((attempt) => attempt.status === "failed").length;
  return `✓ ${label} → ${result.format} via ${result.loader}${
    failures === 0 ? "" : ` after ${failures} failed attempt${failures === 1 ? "" : "s"}`
  } · ${formatMs(result.usage.wallMs)}\n`;
}

export async function convertCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const out = stringFlag(parsed, "out");
  if (out === undefined) {
    throw new UsageError(
      "docture convert requires --out <directory>.",
      "Conversion writes documents and assets beneath this directory.",
    );
  }
  const outputFormat = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const selectedFormat = choiceFlag(parsed, CONVERSION_TARGET) ?? "md";
  const format = FORMAT_MAP[selectedFormat];
  const assets = choiceFlag(parsed, ASSETS) ?? "referenced";
  const concurrency = numberFlag(parsed, "concurrency", { min: 1, max: 64, integer: true });
  const inputs = await expandInputs(parsed.positionals, io.cwd);
  const root = resolve(io.cwd, out);

  // Resolve every target before config wiring or document loading. A collision must
  // cost no parsing, OCR, or model calls.
  const targets = outputPaths(inputs, root, format.extension);
  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });
  const wiringInput: ConversionWiringInput = {
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
  };

  if (boolFlag(parsed, "dry-run")) {
    const plan = await planConversionWiring(wiringInput);
    reportWiring(io, common, style, plan.notes, plan.warnings);
    return emitPlan(io, "convert", inputs, plan, (_input, index) => ({
      ...plan.pipeline,
      format: format.format,
      assets,
      output: { to: "file", path: targets.get(index) },
    }));
  }

  const wiring = await buildConversionWiring(wiringInput);
  reportWiring(io, common, style, wiring.notes, wiring.warnings);

  const records = new Array<Item<{
    output: string;
    assets: readonly string[];
    warnings: ConversionResult["warnings"];
  }> | undefined>(inputs.length);
  const hintsShown = new Set<string>();
  let failed = 0;
  let succeeded = 0;
  try {
    const batch = convertInputs(wiring.converter, inputs, io, {
      format: format.format,
      assets,
      signal,
      concurrency: concurrency ?? wiring.concurrency,
    });
    for await (const item of batch) {
      const label = item.input.label;
      if (!item.outcome.ok) {
        failed += 1;
        const explained = explain(item.outcome.error);
        reportFailure(io, label, explained, style, hintsShown);
        const record = errorRecord(label, explained);
        records[item.index] = record;
        if (outputFormat === "ndjson") io.write(toNdjson(record));
        continue;
      }

      const result = item.outcome.result;
      const target = targets.get(item.index);
      if (target === undefined) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, result.content, "utf8");
      if (assets === "referenced") {
        for (const asset of result.assets) {
          const assetPath = within(root, asset.reference);
          await mkdir(dirname(assetPath), { recursive: true });
          await writeFile(assetPath, asset.bytes);
        }
      }
      const record = {
        file: label, ok: true as const, output: target,
        assets: assets === "referenced" ? result.assets.map((asset) => within(root, asset.reference)) : [],
        warnings: result.warnings,
      };
      records[item.index] = record;
      if (outputFormat === "ndjson") io.write(toNdjson(record));
      succeeded += 1;
      if (!common.quiet) {
        io.diagnostic(successLine(label, result));
        for (const warning of result.warnings) {
          io.diagnostic(`${style.yellow("!")} ${label}: ${warning.message}\n`);
        }
        if (common.verbose) io.diagnostic(attemptLines(result.attempts, style));
      }
    }
  } finally {
    await wiring.dispose();
  }

  if (outputFormat === "json") {
    io.write(toJson(envelope("convert", records.filter((record) => record !== undefined))));
  }

  if (!common.quiet) {
    io.diagnostic(
      `${style.dim("→")} ${succeeded} written to ${root}${failed === 0 ? "" : ` · ${failed} failed`}\n`,
    );
  }
  return failed === 0 ? 0 : 1;
}
