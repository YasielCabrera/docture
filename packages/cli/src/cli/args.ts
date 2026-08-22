/**
 * Argument parsing on top of `node:util`'s `parseArgs`.
 *
 * No parser dependency, on purpose: this package is what `npx` downloads, and a
 * command line is exactly the thing Node already ships. What `parseArgs` does not
 * give is a help text, so a {@link CommandSpec} is the single source of both — the
 * flag that parses and the flag that is documented cannot drift, because they are
 * the same object.
 *
 * `parseArgs` throws a `TypeError` with a `code` for a bad invocation; every one of
 * those becomes a {@link UsageError} naming the command, so exit 2 always means
 * "the command was wrong" and never leaks a stack trace.
 */

import { parseArgs } from "node:util";
import { UsageError } from "./errors.js";

export interface FlagSpec {
  readonly name: string;
  readonly type: "string" | "boolean";
  readonly short?: string;
  /** Shown in help as `--out <path>`. Omit for a boolean. */
  readonly placeholder?: string;
  readonly describe: string;
  /** Repeatable — the value arrives as an array. */
  readonly multiple?: boolean;
  /** Rendered in help after the description, in parentheses. */
  readonly defaultLabel?: string;
}

export interface CommandSpec {
  readonly name: string;
  /** One line, for the top-level command list. */
  readonly summary: string;
  /** The argument part of the usage line, e.g. `<file...>`. */
  readonly args: string;
  readonly flags: readonly FlagSpec[];
  readonly description?: string;
  readonly examples?: readonly string[];
  readonly notes?: readonly string[];
}

/** What `parseArgs` can hand back for one flag, given our option table. */
export type FlagValue = string | boolean | (string | boolean)[] | undefined;

export interface Parsed {
  readonly spec: CommandSpec;
  readonly values: Readonly<Record<string, FlagValue>>;
  readonly positionals: readonly string[];
}

/** Edit distance, two rows at a time. Small because the inputs are flag names. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitution,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

/**
 * "Did you mean". A prefix match first, because a truncation is the commonest
 * typo, then the nearest name within a third of its own length — close enough to
 * be a slip, far enough not to propose `eval` for `extract`.
 */
export function nearest(unknown: string, names: readonly string[]): string | undefined {
  const bare = unknown.replace(/^-+/, "").split("=")[0] ?? "";
  if (bare.length < 2) return undefined;

  const prefix = names.find((name) => name.startsWith(bare) || bare.startsWith(name));
  if (prefix !== undefined) return prefix;

  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const d = distance(bare, name);
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best !== undefined && bestDistance <= Math.max(1, Math.floor(best.length / 3))
    ? best
    : undefined;
}

export function parseCommand(spec: CommandSpec, argv: readonly string[]): Parsed {
  const options: Record<
    string,
    { type: "string" | "boolean"; short?: string; multiple?: boolean }
  > = {};
  for (const flag of spec.flags) {
    options[flag.name] = {
      type: flag.type,
      ...(flag.short === undefined ? {} : { short: flag.short }),
      ...(flag.multiple === true ? { multiple: true } : {}),
    };
  }

  try {
    const parsed = parseArgs({
      args: [...argv],
      options,
      allowPositionals: true,
      strict: true,
    });
    return { spec, values: parsed.values, positionals: parsed.positionals };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    const names = spec.flags.map((f) => f.name);

    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const offender = /'([^']+)'/.exec(message)?.[1] ?? "";
      const near = nearest(offender, names);
      throw new UsageError(
        `Unknown option "${offender}" for \`docture ${spec.name}\`.`,
        near === undefined
          ? `Run \`docture ${spec.name} --help\` for the full list.`
          : `Did you mean --${near}?`,
      );
    }
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      throw new UsageError(message, `Run \`docture ${spec.name} --help\`.`);
    }
    throw new UsageError(message, `Run \`docture ${spec.name} --help\`.`);
  }
}

export function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(parsed: Parsed, name: string): boolean {
  return parsed.values[name] === true;
}

export function listFlag(parsed: Parsed, name: string): readonly string[] {
  const value = parsed.values[name];
  // Only `type: "string"` flags are declared `multiple`, so the booleans in
  // `parseArgs`'s union cannot occur here — filtering is how that is proven.
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export interface NumberRange {
  readonly min?: number;
  readonly max?: number;
  /** Reject a value with a fractional part. */
  readonly integer?: boolean;
}

/**
 * A numeric flag, validated here rather than wherever it is eventually used.
 *
 * `--concurrency abc` should fail before a single byte is read, not after the
 * first document has already gone to a model.
 */
export function numberFlag(
  parsed: Parsed,
  name: string,
  range: NumberRange = {},
): number | undefined {
  const raw = stringFlag(parsed, name);
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError(`--${name} expects a number, got "${raw}".`);
  }
  if (range.integer === true && !Number.isInteger(value)) {
    throw new UsageError(`--${name} expects a whole number, got "${raw}".`);
  }
  if (range.min !== undefined && value < range.min) {
    throw new UsageError(`--${name} must be at least ${range.min}, got ${value}.`);
  }
  if (range.max !== undefined && value > range.max) {
    throw new UsageError(`--${name} must be at most ${range.max}, got ${value}.`);
  }
  return value;
}

/** A flag whose value must be one of a fixed set. Returns the literal type. */
export function choiceFlag<const T extends string>(
  parsed: Parsed,
  name: string,
  choices: readonly T[],
): T | undefined {
  const raw = stringFlag(parsed, name);
  if (raw === undefined) return undefined;
  const match = choices.find((c) => c === raw);
  if (match === undefined) {
    throw new UsageError(
      `--${name} must be one of ${choices.join(", ")}, got "${raw}".`,
    );
  }
  return match;
}
