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

import {
  defineStrategy,
  hasFact,
  type DocumentFeatures,
  type KnownDocumentFact,
  type LoadedPage,
} from "docture";
import { jsonSchema } from "ai";
import { boolFlag, choiceFlag, numberFlag, type Parsed } from "../cli/args.js";
import { explain, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { resolveConfig } from "../config.js";
import { expandInputs } from "../inputs.js";
import { commonOptions, wiringFlags } from "../options.js";
import {
  envelope,
  errorRecord,
  formatCount,
  reportFailure,
  toJson,
  toNdjson,
  OUTPUT_FORMATS,
  type Item,
} from "../output.js";
import { buildWiring } from "../wiring.js";

interface PageReport {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly chars: number;
  readonly lines: number;
}

interface Probe {
  readonly features: DocumentFeatures;
  readonly pages: readonly PageReport[];
  readonly text?: string;
  readonly lines?: readonly { readonly page: number; readonly y: number; readonly text: string }[];
  readonly render?: { readonly pageNumber: number; readonly bytes?: number; readonly error?: string };
}

interface Report extends Probe {
  readonly file: string;
  readonly loader: string;
}

interface ProbeOptions {
  readonly maxPages?: number;
  readonly text: boolean;
  readonly lines: boolean;
  readonly render: boolean;
}

/** Accepts anything: the probe's output is a report, not a user's schema. */
const ANY = jsonSchema({} as Record<string, never>);

function pageReport(page: LoadedPage): PageReport {
  return {
    pageNumber: page.pageNumber,
    width: Math.round(page.width),
    height: Math.round(page.height),
    chars: page.text.trim().length,
    lines: page.lines?.length ?? 0,
  };
}

function probeStrategy(options: ProbeOptions) {
  return defineStrategy({
    name: "inspect",
    async extract(ctx) {
      ctx.signal.throwIfAborted();
      const pages =
        options.maxPages === undefined ? ctx.document.pages : ctx.document.pages.slice(0, options.maxPages);

      let render: Probe["render"];
      if (options.render) {
        const first = pages[0];
        if (first === undefined || first.image === undefined) {
          render = { pageNumber: 0, error: "no page can be rendered" };
        } else {
          try {
            const bytes = await first.image();
            render = { pageNumber: first.pageNumber, bytes: bytes.byteLength };
          } catch (error) {
            render = { pageNumber: first.pageNumber, error: explain(error).message };
          }
        }
      }

      const data: Probe = {
        features: ctx.features,
        pages: pages.map(pageReport),
        ...(options.text ? { text: pages.map((p) => p.text).join("\n\f\n") } : {}),
        ...(options.lines
          ? {
              lines: pages.flatMap((page) =>
                (page.lines ?? []).map((line) => ({
                  page: page.pageNumber,
                  y: Math.round(line.y),
                  text: line.text,
                })),
              ),
            }
          : {}),
        ...(render === undefined ? {} : { render }),
      };
      return { data };
    },
  });
}

const FACTS: readonly KnownDocumentFact[] = ["TEXT_LAYER", "GEOMETRY", "RENDERABLE_PAGES"];

function renderReport(report: Report, style: Style, options: ProbeOptions): string {
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
  const format = choiceFlag(parsed, "format", OUTPUT_FORMATS) ?? "text";
  const maxPages = numberFlag(parsed, "pages", { min: 1, integer: true });

  const options: ProbeOptions = {
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
    before: [probeStrategy(options)],
    ignoreSuppliedExtractor: true,
  });

  if (!common.quiet) {
    if (common.verbose) {
      for (const note of wiring.notes) io.diagnostic(`${style.dim("·")} ${style.dim(note)}\n`);
    }
    for (const warning of wiring.warnings) io.diagnostic(`${style.yellow("!")} ${warning}\n`);
  }

  const reports: Item<Report>[] = [];
  const hintsShown = new Set<string>();
  let failed = 0;

  try {
    for (const input of inputs) {
      try {
        const result = await wiring.extractor.extract(input.source, ANY, {
          signal,
          only: ["inspect"],
        });
        const probe = result.data as Probe;
        const record: Item<Report> = { ...probe, file: input.label, ok: true, loader: result.loader };
        reports.push(record);
        if (format === "ndjson") io.write(toNdjson(record));
      } catch (error) {
        failed += 1;
        const explained = explain(error);
        reportFailure(io, input.label, explained, style, hintsShown);
        const record = errorRecord(input.label, explained);
        reports.push(record);
        if (format === "ndjson") io.write(toNdjson(record));
      }
    }
  } finally {
    await wiring.dispose();
  }

  if (format === "json") {
    io.write(toJson(envelope("inspect", reports)));
  } else if (format === "text") {
    const rendered = reports.filter((report) => report.ok)
      .map((report) => renderReport(report, style, options)).join("\n");
    io.write(rendered);
  }

  return failed === 0 ? 0 : 1;
}
