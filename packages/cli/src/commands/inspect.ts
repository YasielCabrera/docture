/**
 * `docture inspect` — what the loaders see.
 *
 * The answer to "why did no strategy run?", and the one command that needs no
 * model and no API key.
 *
 * It does not re-derive the answer. A probe strategy is pushed onto a real
 * pipeline and reports the `features` core handed it, so what is printed here is
 * by construction the same thing eligibility is decided from — a second
 * implementation of `documentFeatures` would drift, and the day it drifted would
 * be the day someone was using this to work out why their extraction did not run.
 */

import { hasFact, type KnownDocumentFact } from "docture";
import { boolFlag, choiceFlag, numberFlag, type Parsed } from "../cli/args.js";
import { type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { OUTPUT_FORMAT } from "../cli/specs.js";
import { resolveConfig } from "../config.js";
import { expandInputs } from "../inputs.js";
import { commonOptions } from "../options.js";
import { inspectInputs, inspectProbe, type InspectOptions, type InspectReport } from "../operations.js";
import { envelope, formatCount, reportFailure, reportWiring, toJson, toNdjson, type Item } from "../output.js";
import { buildWiring } from "../wiring.js";

const FACTS: readonly KnownDocumentFact[] = ["TEXT_LAYER", "GEOMETRY", "RENDERABLE_PAGES"];

function renderReport(report: Item<InspectReport> & { ok: true }, style: Style, options: InspectOptions): string {
  const f = report.features;
  const yes = (value: boolean): string => (value ? style.green("yes") : style.dim("no"));

  const rows: readonly (readonly [string, string])[] = [
    ["loader", report.loader],
    ["type", f.mimeType],
    ["pages", String(f.pageCount)],
    ["form", f.form === "scanned" ? style.yellow(f.form) : f.form],
    ["text", `${formatCount(f.textLength)} chars`],
    ["geometry", yes(f.hasGeometry)],
    ["renderable", yes(f.hasRenderablePages)],
    ...Object.entries(f.extra ?? {}).map(([fact, value]) => [fact.toLowerCase(), yes(value)] as const),
  ];

  const lines = [
    style.bold(report.file),
    ...rows.map(([label, value]) => `  ${style.dim(label.padEnd(12))}${value}`),
  ];

  if (report.render !== undefined) {
    const { bytes, error, pageNumber } = report.render;
    lines.push(
      `  ${style.dim("render".padEnd(12))}` +
        (error === undefined
          ? style.green(`page ${pageNumber} → ${formatCount(bytes ?? 0)} bytes`)
          : style.red(error)),
    );
  }

  if (report.pages.length > 1) {
    lines.push("", `  ${style.dim("page   size (pt)      chars   lines")}`);
    for (const page of report.pages) {
      lines.push(
        `  ${String(page.pageNumber).padStart(4)}   ${`${page.width} × ${page.height}`.padEnd(13)}` +
          `${formatCount(page.chars).padStart(6)}  ${formatCount(page.lines).padStart(6)}`,
      );
    }
  }

  // The point of the whole command: which `requires` this document satisfies, and
  // therefore which strategies could ever run against it.
  lines.push(
    "",
    `  ${style.dim("a strategy requiring")} ` +
      FACTS.map((fact) =>
        hasFact(f, fact) ? style.green(`${fact} ✓`) : style.dim(`${fact} ✗`),
      ).join("  "),
  );

  if (options.lines && report.lines !== undefined) {
    lines.push("", `  ${style.dim("lines")}`);
    for (const line of report.lines) {
      lines.push(`  ${style.dim(`p${line.page} y=${String(line.y).padStart(4)}`)}  ${line.text}`);
    }
  }
  if (options.text && report.text !== undefined) {
    lines.push("", `  ${style.dim("text")}`, report.text);
  }

  return `${lines.join("\n")}\n`;
}

export async function inspectCommand(
  parsed: Parsed,
  io: Io,
  signal: AbortSignal,
): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const format = choiceFlag(parsed, OUTPUT_FORMAT) ?? "text";
  const maxPages = numberFlag(parsed, "pages", { min: 1, integer: true });

  const options: InspectOptions = {
    ...(maxPages === undefined ? {} : { maxPages }),
    text: boolFlag(parsed, "text"),
    lines: boolFlag(parsed, "lines"),
    render: boolFlag(parsed, "vision"),
  };

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });

  const inputs = await expandInputs(parsed.positionals, io.cwd);
  const timeoutMs = numberFlag(parsed, "timeout", { min: 1, integer: true });
  const wiring = await buildWiring({
    io,
    ...(config === undefined ? {} : { config }),
    // No model and no strategies from flags — just the loaders and the probe.
    flags: {
      ...(options.render ? { vision: true } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
    needsModel: false,
    before: [inspectProbe(options)],
    ignoreSuppliedExtractor: true,
  });
  reportWiring(io, common, style, wiring.notes, wiring.warnings);

  const reports: Item<InspectReport>[] = [];
  const hintsShown = new Set<string>();
  let failed = 0;

  try {
    for await (const record of inspectInputs(wiring.extractor, inputs, io, {}, signal)) {
      reports.push(record);
      if (!record.ok) {
        failed += 1;
        reportFailure(io, record.file, record.error, style, hintsShown);
      }
      if (format === "ndjson") io.write(toNdjson(record));
    }
  } finally {
    await wiring.dispose();
  }

  if (format === "json") {
    io.write(toJson(envelope("inspect", reports)));
  } else if (format === "text") {
    const rendered = reports.filter((report): report is Item<InspectReport> & { ok: true } => report.ok)
      .map((report) => renderReport(report, styleFor(io.stdoutColor && !boolFlag(parsed, "no-color") && io.env["NO_COLOR"] === undefined), options)).join("\n");
    io.write(rendered);
  }

  return failed === 0 ? 0 : 1;
}
