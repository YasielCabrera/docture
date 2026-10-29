import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { caseIdOf } from "@docture/synthetic";
import { degrade } from "@docture/synthetic/degrade";
import { renderPdf } from "@docture/synthetic/pdfkit";
import { assertVerified } from "@docture/synthetic/verify";
import { boolFlag, choiceFlag, stringFlag, type Parsed } from "../cli/args.js";
import { UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io } from "../cli/io.js";
import { LIST_FORMAT } from "../cli/specs.js";
import { commonOptions } from "../options.js";
import { toJson } from "../output.js";
import { describeRendition, loadSynthConfig, oneTemplate, parseRendition, parseSeed, RENDITION_PROFILES, scenarioNamed } from "./config.js";

function requiredSeed(parsed: Parsed): number | string {
  const raw = stringFlag(parsed, "seed");
  if (raw === undefined) throw new UsageError("Missing --seed <seed>.", `Run \`docture ${parsed.spec.name} --help\`.`);
  return parseSeed(raw);
}

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)), []);
  return rows.map((row) => `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ")}`.trimEnd() + "\n").join("");
}

/** `docture synth list`: templates, scenarios and renditions, from the config. */
export async function listCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const style = styleFor(io.stdoutColor && !boolFlag(parsed, "no-color"));
  const { config } = await loadSynthConfig(io.cwd, stringFlag(parsed, "config"));
  const templates = config.templates.map((template) => ({ key: template.key, aliases: template.aliases, family: template.family, tags: template.tags }));
  const scenarios = [{ name: "base", tags: [] as readonly string[] }, ...(config.scenarios ?? []).map((item) => ({ name: item.name, tags: item.tags ?? [] }))];
  const configured = (config.renditions ?? [{ kind: "digital" as const }]).map(describeRendition);
  if (choiceFlag(parsed, LIST_FORMAT) === "json") {
    io.write(toJson({ templates, scenarios, renditions: { profiles: RENDITION_PROFILES, configured } }));
    return 0;
  }
  io.write(`${style.bold("Templates")}\n`);
  io.write(table(templates.map((template) => [template.key, template.family, template.aliases.length === 0 ? "" : `aliases ${template.aliases.join(", ")}`])));
  io.write(`${style.bold("Scenarios")}\n`);
  io.write(table(scenarios.map((item) => [item.name, item.tags.join(", ")])));
  io.write(`${style.bold("Renditions")}\n`);
  io.write(table([["profiles", RENDITION_PROFILES.map((name) => (name === "digital" ? name : `${name}:<severity>`)).join(", ")], ["configured", configured.join(", ")]]));
  return 0;
}

/** `docture synth gen`: one sampled value, as JSON on stdout. */
export async function genCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const seed = requiredSeed(parsed);
  const { config } = await loadSynthConfig(io.cwd, stringFlag(parsed, "config"));
  const scenario = scenarioNamed(config, stringFlag(parsed, "scenario"));
  const sample = await config.model.sample({ seed, ...(scenario === undefined ? {} : { scenario }) });
  io.write(toJson(sample.value));
  return 0;
}

/** `docture synth render`: one document at `--out`, its expected value and labels at `<out>.labels.json`. */
export async function renderCommand(parsed: Parsed, io: Io): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const seed = requiredSeed(parsed);
  const outFlag = stringFlag(parsed, "out");
  if (outFlag === undefined) throw new UsageError("Missing --out <file>.", "Run `docture synth render --help`.");
  const spec = parseRendition(stringFlag(parsed, "rendition") ?? "digital");
  const { config } = await loadSynthConfig(io.cwd, stringFlag(parsed, "config"));
  const template = oneTemplate(config, stringFlag(parsed, "template"));
  const scenario = scenarioNamed(config, stringFlag(parsed, "scenario"));

  const sample = await config.model.sample({ seed, ...(scenario === undefined ? {} : { scenario }) });
  const rendered = await renderPdf(template, sample, config.createdAt === undefined ? {} : { createdAt: config.createdAt });
  const verified = !boolFlag(parsed, "no-verify");
  if (verified) await assertVerified(rendered);
  const document = spec.kind === "digital" ? rendered : await degrade(rendered, { profile: spec.profile, severity: spec.severity });

  const out = resolve(io.cwd, outFlag);
  const labels = `${out}.labels.json`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, document.bytes);
  await writeFile(labels, toJson({ id: caseIdOf(document), rendition: document.rendition, pages: document.pages, expected: document.expected, labels: document.labels }));
  if (!common.quiet) {
    const checked = verified ? `, ${document.labels.length} label${document.labels.length === 1 ? "" : "s"} verified` : ", not verified";
    io.diagnostic(`${style.green("✓")} ${template.key} seed ${seed} ${sample.scenario} ${describeRendition(spec)} → ${outFlag}${checked}\n`);
  }
  return 0;
}
