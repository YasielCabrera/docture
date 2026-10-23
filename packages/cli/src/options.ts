/**
 * Reading the flag groups from {@link ../cli/specs.ts} back out of a parse.
 *
 * Split out so `extract` and `eval`, which share the model and run flags, read
 * them by the same code — a `--dpi` that meant something different in one command
 * would be a bug nobody would look for.
 */

import type { CompletionStrategy } from "docture";
import { boolFlag, choiceFlag, numberFlag, stringFlag, type Parsed } from "./cli/args.js";
import type { WiringFlags } from "./wiring.js";

export interface CommonOptions {
  readonly configPath?: string;
  readonly noConfig: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly color: boolean;
}

export function commonOptions(parsed: Parsed, colorAvailable: boolean): CommonOptions {
  const configPath = stringFlag(parsed, "config");
  return {
    ...(configPath === undefined ? {} : { configPath }),
    noConfig: boolFlag(parsed, "no-config"),
    verbose: boolFlag(parsed, "verbose"),
    quiet: boolFlag(parsed, "quiet"),
    color: colorAvailable && !boolFlag(parsed, "no-color"),
  };
}

const COMPLETIONS = ["forbidden", "paginate", "concatenate"] as const satisfies readonly CompletionStrategy[];

/** Every flag the wiring cares about, validated. Absent stays absent. */
export function wiringFlags(parsed: Parsed): WiringFlags {
  const model = stringFlag(parsed, "model");
  const pricingPath = stringFlag(parsed, "pricing");
  const cacheDir = stringFlag(parsed, "cache");
  const instructions = stringFlag(parsed, "instructions");
  const classificationsPath = stringFlag(parsed, "classifications");
  const temperature = numberFlag(parsed, "temperature", { min: 0, max: 2 });
  const dpi = numberFlag(parsed, "dpi", { min: 36, max: 1200, integer: true });
  const maxPages = numberFlag(parsed, "max-pages", { min: 1, integer: true });
  const maxChars = numberFlag(parsed, "max-chars", { min: 256, integer: true });
  const timeoutMs = numberFlag(parsed, "timeout", { min: 1, integer: true });
  const completion = choiceFlag(parsed, "completion", COMPLETIONS);

  return {
    ...(model === undefined ? {} : { model }),
    ...(boolFlag(parsed, "gateway") ? { gateway: true } : {}),
    ...(pricingPath === undefined ? {} : { pricingPath }),
    ...(cacheDir === undefined ? {} : { cacheDir }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(boolFlag(parsed, "vision") ? { vision: true } : {}),
    ...(dpi === undefined ? {} : { dpi }),
    ...(maxPages === undefined ? {} : { maxPages }),
    ...(completion === undefined ? {} : { completion }),
    ...(maxChars === undefined ? {} : { maxChars }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(boolFlag(parsed, "classify") ? { classify: true } : {}),
    ...(boolFlag(parsed, "assist-layout") ? { assistLayout: true } : {}),
    ...(classificationsPath === undefined ? {} : { classificationsPath }),
  };
}
