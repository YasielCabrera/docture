/**
 * Help text, rendered from the same specs the parser is built from.
 *
 * Written to stderr like every other diagnostic, and to stdout only when help was
 * what you asked for — `docture --help | less` should work.
 */

import { usageArgs, type CommandSpec, type FlagSpec } from "./args.js";
import { COMMANDS } from "./specs.js";
import type { Style } from "./io.js";
import { ENVIRONMENT } from "../environment.js";
import { envelope, type Envelope } from "../output.js";

const INDENT = "  ";

function flagLabel(flag: FlagSpec): string {
  const short = flag.short === undefined ? "    " : `-${flag.short}, `;
  const value = flag.placeholder === undefined ? "" : ` ${flag.placeholder}`;
  return `${short}--${flag.name}${value}`;
}

function flagDescription(flag: FlagSpec): string {
  const choices = flag.choices === undefined ? "" : `${flag.choices.join(" | ")}. `;
  const fallback = flag.defaultLabel === undefined ? "" : ` (default: ${flag.defaultLabel})`;
  return `${choices}${flag.describe}${fallback}`;
}

function environmentFor(specs: readonly CommandSpec[]): readonly (readonly [string, string])[] {
  return specs.some((spec) => spec.flags.some((flag) => flag.name === "model"))
    ? ENVIRONMENT
    : ENVIRONMENT.filter(([name]) => name === "NO_COLOR");
}

/** Two aligned columns, wrapping the right one so a narrow terminal stays readable. */
function columns(
  rows: readonly (readonly [string, string])[],
  style: Style,
  width = 80,
): string[] {
  const labelWidth = Math.min(34, Math.max(...rows.map(([label]) => label.length)));
  const out: string[] = [];

  for (const [label, describe] of rows) {
    const gutter = labelWidth + 3;
    const room = Math.max(24, width - gutter);
    const words = describe.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (line.length > 0 && line.length + 1 + word.length > room) {
        lines.push(line);
        line = word;
      } else {
        line = line.length === 0 ? word : `${line} ${word}`;
      }
    }
    if (line.length > 0) lines.push(line);

    const first = lines[0] ?? "";
    out.push(`${INDENT}${style.cyan(label.padEnd(labelWidth))}  ${first}`);
    for (const rest of lines.slice(1)) out.push(`${INDENT}${" ".repeat(labelWidth)}  ${rest}`);
  }
  return out;
}

export function commandHelp(spec: CommandSpec, style: Style): string {
  const lines: string[] = [
    `${style.bold("docture " + spec.name)} — ${spec.summary}`,
    "",
    style.bold("USAGE"),
    `${INDENT}docture ${spec.name}${spec.positionals.length === 0 ? "" : ` ${usageArgs(spec)}`} [options]`,
  ];

  if (spec.description !== undefined) {
    lines.push("", ...spec.description.split("\n").map((l) => `${INDENT}${l}`));
  }

  lines.push("", style.bold("OPTIONS"));
  lines.push(
    ...columns(spec.flags.map((f) => [flagLabel(f), flagDescription(f)] as const), style),
  );

  if (spec.notes !== undefined && spec.notes.length > 0) {
    lines.push("", style.bold("NOTES"), ...spec.notes.map((n) => `${INDENT}${n}`));
  }
  lines.push("", style.bold("ENVIRONMENT"), ...columns(environmentFor([spec]), style));
  if (spec.examples !== undefined && spec.examples.length > 0) {
    lines.push("", style.bold("EXAMPLES"), ...spec.examples.map((e) => `${INDENT}${style.dim(e)}`));
  }

  return `${lines.join("\n")}\n`;
}

export function topLevelHelp(style: Style, version: string): string {
  const lines: string[] = [
    `${style.bold("docture")} ${style.dim(version)} — strongly-typed structured data extraction from any document.`,
    "",
    style.bold("USAGE"),
    `${INDENT}docture <command> [files...] [options]`,
    "",
    style.bold("COMMANDS"),
    ...columns(
      COMMANDS.map((c) => [c.name, c.summary] as const),
      style,
    ),
    "",
    style.bold("OPTIONS"),
    ...columns(
      [
        ["-h, --help", "Show help. `docture <command> --help` for a command"],
        ["--version", "Print the version"],
      ],
      style,
    ),
    "",
    style.bold("ENVIRONMENT"),
    ...columns(ENVIRONMENT, style),
    "",
    style.bold("EXAMPLES"),
    `${INDENT}${style.dim("docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5")}`,
    `${INDENT}${style.dim("docture inspect scan.pdf")}`,
    "",
    `${INDENT}${style.dim("Wire loaders, strategies and a model once in docture.config.ts and drop the flags.")}`,
  ];
  return `${lines.join("\n")}\n`;
}

export interface HelpSpec {
  readonly name: string;
  readonly summary: string;
  readonly description?: string;
  readonly positionals: readonly {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
    readonly variadic: boolean;
  }[];
  readonly flags: readonly {
    readonly name: string;
    readonly type: FlagSpec["type"];
    readonly short?: string;
    readonly placeholder?: string;
    readonly multiple?: boolean;
    readonly choices?: readonly string[];
    readonly defaultLabel?: string;
    readonly description: string;
  }[];
}

export type HelpEnvelope = Envelope<
  { readonly spec: HelpSpec },
  { readonly environment: readonly { readonly name: string; readonly description: string }[] }
>;

/** `help --json`: the same specs the parser is built from, so the two cannot drift. */
export function helpEnvelope(specs: readonly CommandSpec[]): HelpEnvelope {
  return envelope(
    "help",
    specs.map((spec) => ({
      file: spec.name,
      ok: true as const,
      spec: {
        name: spec.name,
        summary: spec.summary,
        ...(spec.description === undefined ? {} : { description: spec.description.replaceAll("\n", " ") }),
        positionals: spec.positionals.map((p) => ({
          name: p.name,
          description: p.describe,
          required: p.required,
          variadic: p.variadic,
        })),
        flags: spec.flags.map((f) => ({
          name: f.name,
          type: f.type,
          ...(f.short === undefined ? {} : { short: f.short }),
          ...(f.placeholder === undefined ? {} : { placeholder: f.placeholder }),
          ...(f.multiple === true ? { multiple: true } : {}),
          ...(f.choices === undefined ? {} : { choices: f.choices }),
          ...(f.defaultLabel === undefined ? {} : { defaultLabel: f.defaultLabel }),
          description: f.describe,
        })),
      },
    })),
    { environment: environmentFor(specs).map(([name, description]) => ({ name, description })) },
  );
}
