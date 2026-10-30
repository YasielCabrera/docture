import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMMANDS, HELP } from "../../../packages/cli/src/cli/specs.js";

const directory = resolve(import.meta.dirname, "../content/docs/cli/commands");
const commands = [...COMMANDS.flatMap((command) => [command, ...command.subcommands ?? []]), HELP];
const check = process.argv.includes("--check");
const mdx = (text: string): string => text.split(/(`[^`]*`)/g).map((part, index) => index % 2 === 0 ? part.replace(/[<>{}]/g, (character) => `&#${character.charCodeAt(0)};`) : part).join("");
const cell = (text: string): string => mdx(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const slug = (name: string): string => name.replaceAll(" ", "-");
const sentence = (text: string): string => /[.!?]$/.test(text) ? text : `${text}.`;

await mkdir(directory, { recursive: true });
for (const command of commands) {
  const lines = ["---", `title: ${JSON.stringify(`docture ${command.name}`)}`, `description: ${JSON.stringify(command.summary)}`, "type: reference", "---", "", mdx(sentence(command.description ?? command.summary)), ""];
  if (command.positionals.length > 0) {
    lines.push("## Arguments", "", "| Argument | Required | Meaning |", "| --- | --- | --- |");
    for (const argument of command.positionals) lines.push(`| \`${argument.name}${argument.variadic ? "..." : ""}\` | ${argument.required ? "Yes" : "No"} | ${cell(argument.describe)} |`);
    lines.push("");
  }
  lines.push("## Flags", "", "| Flag | Default | Meaning |", "| --- | --- | --- |");
  for (const flag of command.flags) {
    const names = `\`--${flag.name}${flag.placeholder === undefined ? "" : ` ${flag.placeholder}`}\`${flag.short === undefined ? "" : `, \`-${flag.short}\``}`;
    const extra = `${flag.choices === undefined ? "" : ` Choices: ${flag.choices.map((choice) => `\`${choice}\``).join(", ")}.`}${flag.multiple && !/\bRepeatable\.?$/.test(flag.describe) ? " Repeatable." : ""}`;
    lines.push(`| ${cell(names)} | ${cell(flag.defaultLabel ?? "Not set")} | ${cell(extra === "" ? flag.describe : sentence(flag.describe) + extra)} |`);
  }
  if (command.examples !== undefined) lines.push("", "## Examples", "", "```sh", ...command.examples, "```");
  if (command.notes !== undefined) {
    lines.push("", "## Behavior", "");
    for (const note of command.notes) {
      const trimmed = note.trim();
      if (trimmed.startsWith("{")) {
        lines.push("", "```json", JSON.stringify(JSON.parse(trimmed), null, 2), "```", "");
      } else if (/^\s{2}/.test(note)) {
        lines[lines.length - 1] += ` ${mdx(trimmed)}`;
      } else {
        lines.push(`- ${mdx(note)}`);
      }
    }
  }
  if (command.subcommands !== undefined) lines.push("", "## Subcommands", "", ...command.subcommands.map((child) => `- [\`docture ${child.name}\`](/docs/cli/commands/${slug(child.name)}). ${child.summary}.`));
  const guide = command.name.split(" ")[0] === "eval"
    ? "[Evaluate from the CLI](/docs/cli/evaluation)"
    : command.name.split(" ")[0] === "synth"
      ? "[synthetic corpora from the command line](/docs/synthetic/corpora#use-the-cli)"
      : "[CLI configuration](/docs/cli/configuration)";
  lines.push("", `See ${guide} and [input and output behavior](/docs/cli/inputs-and-outputs).`, "");
  const file = resolve(directory, `${slug(command.name)}.mdx`);
  const content = lines.join("\n").replace(/(\d)–(\d)/g, "$1 to $2").replace(/\s*[—–]\s*/g, ", ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (check) {
    if (await readFile(file, "utf8") !== content) throw new Error(`Command reference is stale: ${file}. Run pnpm --filter @docture/docs generate:commands.`);
  } else await writeFile(file, content);
}
const metaFile = resolve(directory, "meta.json");
const families = COMMANDS.filter((command) => command.subcommands !== undefined);
const pages = [
  "---Commands---",
  ...COMMANDS.filter((command) => command.subcommands === undefined).map((command) => slug(command.name)),
  ...families.flatMap((family) => [`---docture ${family.name}---`, slug(family.name), ...(family.subcommands ?? []).map((child) => slug(child.name))]),
  "---Help---",
  slug(HELP.name),
];
const meta = JSON.stringify({ title: "Command reference", pagesIndex: "index", pages }, null, 2) + "\n";
if (check) {
  if (await readFile(metaFile, "utf8") !== meta) throw new Error("Command reference navigation is stale.");
} else await writeFile(metaFile, meta);
console.log(`Command reference ${check ? "verified" : "generated"}: ${commands.length} commands.`);
