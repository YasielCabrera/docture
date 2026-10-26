/** `docture convert`: grounded PDF conversion with explicit filesystem output. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type ConversionAssetMode,
  type ConversionFormat,
  type ConversionResult,
} from "docture";
import { choiceFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { explain, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs, stem, type Input } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  attemptLines,
  envelope,
  errorRecord,
  formatMs,
  reportFailure,
  toJson,
  toNdjson,
  OUTPUT_FORMATS,
  type Item,
} from "../output.js";
import { buildConversionWiring } from "../wiring.js";

const FORMATS = ["md", "html", "txt", "json"] as const;
const ASSET_MODES = ["referenced", "embedded", "omit"] as const satisfies readonly ConversionAssetMode[];

const FORMAT_MAP: Readonly<
  Record<(typeof FORMATS)[number], { format: ConversionFormat; extension: string }>
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
        `"${clash}" and "${input.source}" would both be written to ${path}.`,
        "Rename one input before converting the batch.",
      );
    }
    taken.set(path, input.source);
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
  const outputFormat = choiceFlag(parsed, "format", OUTPUT_FORMATS) ?? "text";
  const selectedFormat = choiceFlag(parsed, "to", FORMATS) ?? "md";
  const format = FORMAT_MAP[selectedFormat];
  const assets = choiceFlag(parsed, "assets", ASSET_MODES) ?? "referenced";
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
  const wiring = await buildConversionWiring({
    io,
    ...(config === undefined ? {} : { config }),
    flags: wiringFlags(parsed),
  });

  if (!common.quiet) {
    if (common.verbose) {
      for (const note of wiring.notes) io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
    }
    for (const warning of wiring.warnings) io.diagnostic(`${style.yellow("!")} ${warning}\n`);
  }

  const records = new Array<Item<{
    output: string;
    assets: readonly string[];
    warnings: ConversionResult["warnings"];
  }> | undefined>(inputs.length);
  const hintsShown = new Set<string>();
  let failed = 0;
  let succeeded = 0;
  try {
    const batch = wiring.converter.convertBatch(
      inputs.map((input) => input.source),
      {
        format: format.format,
        assets,
        signal,
        concurrency: concurrency ?? wiring.concurrency,
      },
    );
    for await (const item of batch) {
      const input = inputs[item.index];
      const label = input?.label ?? String(item.index);
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
