import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMMANDS, HELP } from "../../../packages/cli/src/cli/specs.js";

const directory = resolve(import.meta.dirname, "../content/docs/cli/commands");
const commands = [...COMMANDS.flatMap((command) => [command, ...command.subcommands ?? []]), HELP];
const check = process.argv.includes("--check");
const mdx = (text: string): string => text.split(/(`[^`]*`)/g).map((part, index) => index % 2 === 0 ? part.replace(/[<>{}]/g, (character) => `&#${character.charCodeAt(0)};`) : part).join("");
const cell = (text: string): string => mdx(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const slug = (name: string): string => name.replaceAll(" ", "-");

await mkdir(directory, { recursive: true });
for (const command of commands) {
  const lines = ["---", `title: ${JSON.stringify(`docture ${command.name}`)}`, `description: ${JSON.stringify(command.summary)}`, "---", "", mdx(command.description ?? command.summary), ""];
  if (command.positionals.length > 0) {
    lines.push("## Arguments", "", "| Argument | Required | Meaning |", "| --- | --- | --- |");
    for (const argument of command.positionals) lines.push(`| \`${argument.name}${argument.variadic ? "..." : ""}\` | ${argument.required ? "Yes" : "No"} | ${cell(argument.describe)} |`);
    lines.push("");
  }
  lines.push("## Flags", "", "| Flag | Default | Meaning |", "| --- | --- | --- |");
  for (const flag of command.flags) {
    const names = `\`--${flag.name}${flag.placeholder === undefined ? "" : ` ${flag.placeholder}`}\`${flag.short === undefined ? "" : `, \`-${flag.short}\``}`;
    const extra = `${flag.choices === undefined ? "" : ` Choices: ${flag.choices.map((choice) => `\`${choice}\``).join(", ")}.`}${flag.multiple ? " Repeatable." : ""}`;
    lines.push(`| ${cell(names)} | ${cell(flag.defaultLabel ?? "Not set")} | ${cell(flag.describe + extra)} |`);
  }
  if (command.examples !== undefined) lines.push("", "## Examples", "", "```sh", ...command.examples, "```");
  if (command.notes !== undefined) lines.push("", "## Behavior", "", ...command.notes.map((note) => `- ${mdx(note)}`));
  if (command.subcommands !== undefined) lines.push("", "## Subcommands", "", ...command.subcommands.map((child) => `- [\`docture ${child.name}\`](/docs/cli/commands/${slug(child.name)}). ${child.summary}.`));
  lines.push("", "See [CLI configuration](/docs/cli/configuration) and [input and output behavior](/docs/cli/inputs-and-outputs).", "");
  const file = resolve(directory, `${slug(command.name)}.mdx`);
  const content = lines.join("\n").replace(/[—–]/g, ",").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (check) {
    if (await readFile(file, "utf8") !== content) throw new Error(`Command reference is stale: ${file}. Run pnpm --filter @docture/docs generate:commands.`);
  } else await writeFile(file, content);
}
const metaFile = resolve(directory, "meta.json");
const meta = JSON.stringify({ title: "Command reference", pagesIndex: "index", pages: [...commands.map((command) => slug(command.name))] }, null, 2) + "\n";
if (check) {
  if (await readFile(metaFile, "utf8") !== meta) throw new Error("Command reference navigation is stale.");
} else await writeFile(metaFile, meta);
console.log(`Command reference ${check ? "verified" : "generated"}: ${commands.length} commands.`);
