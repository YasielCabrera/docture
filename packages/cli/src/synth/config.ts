import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { selectTemplates, type Scenario, type SynthConfig, type SynthRendition, type SynthTemplate } from "@docture/synthetic";
import type { ProfileKey } from "@docture/synthetic/degrade";
import type { RenditionSpec } from "@docture/synthetic/node";
import { UsageError } from "../cli/errors.js";
import { loadExport } from "../load-module.js";

const FILENAMES = ["docture.synth.ts", "docture.synth.mts", "docture.synth.js", "docture.synth.mjs"] as const;
const DEFAULT_OUT = "corpus";
const PROFILES = ["scan", "scan-lq", "photo", "fax"] as const satisfies readonly ProfileKey[];
const RENDITION_HINT = `Use digital, or a profile and a severity from 0 to 1: ${PROFILES.map((profile) => `${profile}:0.5`).join(", ")}.`;

export interface LoadedSynthConfig {
  readonly config: SynthConfig<unknown>;
  /** Absolute path of the config file. Relative paths in it resolve from its directory. */
  readonly path: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isSeed = (value: unknown): boolean => typeof value === "string" || Number.isFinite(value);

function renditionProblem(value: unknown): string | undefined {
  if (!isObject(value)) return "is not a rendition";
  if (value["kind"] === "digital") return undefined;
  if (value["kind"] !== "degrade") return 'needs kind "digital" or "degrade"';
  const profile = value["profile"];
  if (!(PROFILES as readonly unknown[]).includes(profile) && !(isObject(profile) && typeof profile["key"] === "string")) return "needs a profile key or profile";
  const severity = value["severity"];
  if (typeof severity !== "number" || !(severity >= 0 && severity <= 1)) return "needs a severity from 0 to 1";
  return undefined;
}

function configProblems(value: unknown): string[] {
  if (!isObject(value)) return ["the default export must be an object from defineSynthConfig"];
  const problems: string[] = [];
  const model = value["model"];
  if (!isObject(model) || typeof model["sample"] !== "function" || !isObject(model["schema"])) problems.push("model must be a model from defineModel");
  const templates = value["templates"];
  if (!Array.isArray(templates) || templates.length === 0) problems.push("templates must be a non-empty array of templates");
  else {
    templates.forEach((template: unknown, index) => {
      if (!isObject(template) || typeof template["key"] !== "string" || typeof template["family"] !== "string" || !Array.isArray(template["aliases"]) || (typeof template["draw"] !== "function" && typeof template["renderDocument"] !== "function")) {
        problems.push(`templates[${index}] must be a template from defineTemplate or defineReactTemplate`);
      }
    });
  }
  const scenarios = value["scenarios"];
  if (scenarios !== undefined && (!Array.isArray(scenarios) || !scenarios.every((item) => isObject(item) && typeof item["name"] === "string"))) {
    problems.push("scenarios must be an array of scenarios, each with a name");
  }
  const seeds = value["seeds"];
  if (seeds !== undefined && (!Array.isArray(seeds) || !seeds.every(isSeed))) problems.push("seeds must be an array of numbers or strings");
  const renditions = value["renditions"];
  if (renditions !== undefined) {
    if (!Array.isArray(renditions)) problems.push("renditions must be an array such as [digital(), scan({ severity: 0.3 })]");
    else renditions.forEach((item: unknown, index) => {
      const problem = renditionProblem(item);
      if (problem !== undefined) problems.push(`renditions[${index}] ${problem}`);
    });
  }
  for (const name of ["out", "createdAt"]) if (value[name] !== undefined && typeof value[name] !== "string") problems.push(`${name} must be a string`);
  return problems;
}

/** The nearest `docture.synth.*`, walking up from `cwd`. */
async function findSynthConfig(cwd: string): Promise<string | undefined> {
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    for (const name of FILENAMES) {
      const candidate = join(directory, name);
      if (await stat(candidate).then((info) => info.isFile(), () => false)) return candidate;
    }
    if (dirname(directory) === directory) return undefined;
  }
}

/** Load and check `--config`, or the nearest `docture.synth.*`. */
export async function loadSynthConfig(cwd: string, explicit: string | undefined): Promise<LoadedSynthConfig> {
  const path = explicit === undefined ? await findSynthConfig(cwd) : isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  if (path === undefined) {
    throw new UsageError(
      `No docture.synth.ts in ${cwd} or any parent directory.`,
      "Create docture.synth.ts with defineSynthConfig from @docture/synthetic, or pass --config <path>.",
    );
  }
  const loaded = await loadExport<unknown>(path, { kind: "config", cwd, names: ["config"] });
  const problems = configProblems(loaded.value);
  if (problems.length > 0) {
    throw new UsageError(
      `The synth config ${loaded.from} is invalid:${problems.map((problem) => `\n  - ${problem}`).join("")}`,
      "Export defineSynthConfig({ model, templates }) from @docture/synthetic.",
    );
  }
  return { config: loaded.value as SynthConfig<unknown>, path: loaded.from };
}

/** `--out`, else the config's `out` beside the config, else `corpus` beside the config. */
export function corpusDirectory(loaded: LoadedSynthConfig, flag: string | undefined, cwd: string): string {
  return flag === undefined ? resolve(dirname(loaded.path), loaded.config.out ?? DEFAULT_OUT) : resolve(cwd, flag);
}

/** Templates by key, alias, family or `all`. */
export function templatesFor<T>(config: SynthConfig<T>, selectors: readonly string[]): readonly SynthTemplate<T>[] {
  if (selectors.length === 0) return config.templates;
  try {
    return selectTemplates(config.templates, selectors);
  } catch (error) {
    if (error instanceof RangeError) throw new UsageError(`${error.message}.`, "`docture synth list` shows every template with its aliases and family.");
    throw error;
  }
}

/** Exactly one template: the one `selector` names, or the config's only template when there is no selector. */
export function oneTemplate<T>(config: SynthConfig<T>, selector: string | undefined): SynthTemplate<T> {
  if (selector === undefined) {
    const [only, ...others] = config.templates;
    if (only !== undefined && others.length === 0) return only;
    throw new UsageError("Missing --template <selector>.", `The config defines: ${config.templates.map((template) => template.key).join(", ")}.`);
  }
  const [chosen, ...others] = templatesFor(config, [selector]);
  if (chosen === undefined || others.length > 0) {
    throw new UsageError(`"${selector}" matches ${others.length + 1} templates.`, "Name one template by its key or alias.");
  }
  return chosen;
}

/** The scenario called `name`. `base` and no name both mean the unvaried model. */
export function scenarioNamed<T>(config: SynthConfig<T>, name: string | undefined): Scenario<T> | undefined {
  if (name === undefined || name === "base") return undefined;
  const found = config.scenarios?.find((item) => item.name === name);
  if (found === undefined) {
    throw new UsageError(`Unknown scenario "${name}".`, `The config defines: ${["base", ...(config.scenarios ?? []).map((item) => item.name)].join(", ")}.`);
  }
  return found;
}

/** A seed as the API takes it: digits are a number, anything else is a string. `7` and `"7"` give different samples. */
export function parseSeed(text: string): number | string {
  const trimmed = text.trim();
  if (trimmed === "") throw new UsageError("A seed cannot be empty.");
  return /^-?\d+$/u.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : trimmed;
}

/** `1-40`, `1,2,3` or a mix such as `1-3,7,smoke`, in order and without repeats. */
export function parseSeeds(text: string): readonly (number | string)[] {
  const seeds: (number | string)[] = [];
  for (const part of text.split(",").map((item) => item.trim()).filter((item) => item !== "")) {
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range === null) {
      seeds.push(parseSeed(part));
      continue;
    }
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (from > to) throw new UsageError(`The seed range "${part}" runs backwards.`, `Write it as ${to}-${from}.`);
    for (let seed = from; seed <= to; seed += 1) seeds.push(seed);
  }
  if (seeds.length === 0) throw new UsageError(`"${text}" names no seed.`, "Pass seeds such as 1-40 or 1,2,3.");
  return [...new Set(seeds)];
}

/** `digital`, or `<profile>:<severity>` such as `scan:0.3`, `scan-lq:0.5`, `photo:0.6` or `fax:0.5`. */
export function parseRendition(text: string): RenditionSpec {
  const trimmed = text.trim();
  if (trimmed === "digital") return { kind: "digital" };
  const [kind = "", severityText, ...rest] = trimmed.split(":");
  const profile = PROFILES.find((name) => name === kind);
  if (profile === undefined) throw new UsageError(`Unknown rendition "${trimmed}".`, RENDITION_HINT);
  const severity = severityText === undefined || severityText.trim() === "" ? Number.NaN : Number(severityText);
  if (rest.length > 0 || !(severity >= 0 && severity <= 1)) {
    throw new UsageError(`The rendition "${trimmed}" needs a severity from 0 to 1 after "${profile}:".`, RENDITION_HINT);
  }
  return { kind: "degrade", profile, severity };
}

/** How `--rendition` writes a rendition: `digital` or `scan:0.3`. */
export function describeRendition(spec: SynthRendition): string {
  if (spec.kind === "digital") return "digital";
  return `${typeof spec.profile === "string" ? spec.profile : spec.profile.key}:${spec.severity}`;
}

export const RENDITION_PROFILES: readonly string[] = ["digital", ...PROFILES];
