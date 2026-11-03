import { supportedInstallCommands } from "./install-specs.js";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { COMMANDS, HELP } from "../../../packages/cli/src/cli/specs.js";
import { captureIo, run, type ExitCode } from "../../../packages/cli/src/index.js";

const directory = resolve(import.meta.dirname, "../content/docs/cli/commands");
const commands = [...COMMANDS.flatMap((command) => [command, ...command.subcommands ?? []]), HELP];
const check = process.argv.includes("--check");
const mdx = (text: string): string => text.split(/(`[^`]*`)/g).map((part, index) => index % 2 === 0 ? part.replace(/[<>{}]/g, (character) => `&#${character.charCodeAt(0)};`) : part).join("");
const cell = (text: string): string => mdx(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const slug = (name: string): string => name.replaceAll(" ", "-");
const sentence = (text: string): string => /[.!?]$/.test(text) ? text : `${text}.`;

interface CommandTranscript {
  readonly argv: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: ExitCode;
  readonly artifact?: { readonly path: string; readonly json: unknown };
}

async function commandTranscripts(): Promise<ReadonlyMap<string, readonly CommandTranscript[]>> {
  const cwd = await mkdtemp(resolve(import.meta.dirname, "../.command-reference-"));
  const dataset = resolve(cwd, "dataset/invoice-001");
  const config = `import { fileURLToPath } from "node:url";
import { defineEval, exact } from "@docture/eval";
import { folderDataset } from "@docture/eval/node";
const parser = { id: "parser", async extract(item) {
  return { raw: JSON.parse(new TextDecoder().decode(await item.documents[0].bytes())) };
} };
export default {
  dataset: folderDataset(fileURLToPath(new URL("./dataset/", import.meta.url)), { id: "invoices", documents: "doc.json", expected: "expected.json", drafts: "skip" }),
  spec: defineEval({ type: "object", properties: { invoiceNumber: { type: "string" } }, required: ["invoiceNumber"], additionalProperties: false }, { strings: exact() }),
  experiments: { parser },
};
`;
  async function transcript(argv: readonly string[], expected: ExitCode): Promise<CommandTranscript> {
    const io = captureIo({ cwd, color: false, stdoutColor: false });
    const exitCode = await run(argv, { io });
    assert.equal(exitCode, expected, io.stderr);
    return { argv, stdout: io.stdout, stderr: io.stderr, exitCode };
  }
  try {
    await mkdir(dataset, { recursive: true });
    await writeFile(resolve(dataset, "doc.json"), JSON.stringify({ invoiceNumber: "INV-42" }));
    await writeFile(resolve(cwd, "docture.eval.mjs"), config);
    await writeFile(resolve(cwd, "ambiguous.eval.mjs"), config.replace("experiments: { parser },", "experiments: { parser, other: { ...parser, id: 'other' } },"));
    const draft = await transcript(["eval", "draft", "--experiment", "parser"], 0);
    const draftFile = "dataset/invoice-001/expected.draft.json";
    const draftJson: unknown = JSON.parse(await readFile(resolve(cwd, draftFile), "utf8"));
    const ambiguous = await transcript(["eval", "draft", "--config", "ambiguous.eval.mjs"], 2);
    const signed = await transcript(["eval", "sign-off", "invoice-001"], 0);
    const missingCase = await transcript(["eval", "sign-off"], 2);
    const valid = await transcript(["eval", "validate"], 0);
    await writeFile(resolve(dataset, "expected.json"), JSON.stringify({ invoiceNumber: 42 }));
    const invalid = await transcript(["eval", "validate"], 1);
    await writeFile(resolve(cwd, "docture.synth.mjs"), `import { defineModel, defineSynthConfig, defineTemplate, gen, locales } from "@docture/synthetic";
import { z } from "zod";
const model = defineModel(z.object({ invoiceNumber: z.string() }), { fields: { invoiceNumber: gen.pick(["INV-42"]) } });
const invoice = defineTemplate()({
  key: "invoice", family: "invoice", aliases: ["default"], locale: locales["en-US"], printed: { invoiceNumber: true },
  draw(page, value) { page.field("invoiceNumber", value.invoiceNumber, { x: 36, y: 36, width: 240, height: 18 }); },
});
export default defineSynthConfig({ model, templates: [invoice] });
`);
    const listed = await transcript(["synth", "list", "--format", "json"], 0);
    const invalidFormat = await transcript(["synth", "list", "--format", "xml"], 2);
    return new Map([
      ["eval draft", [{ ...draft, artifact: { path: draftFile, json: draftJson } }, ambiguous]],
      ["eval sign-off", [signed, missingCase]],
      ["eval validate", [valid, invalid]],
      ["synth list", [listed, invalidFormat]],
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const transcripts = await commandTranscripts();

await mkdir(directory, { recursive: true });
for (const command of commands) {
  const lines = ["---", `title: ${JSON.stringify(`docture ${command.name}`)}`, `description: ${JSON.stringify(command.summary)}`, "type: reference", "---", "", mdx(sentence(command.description ?? command.summary)), "", "Examples use the project-local CLI installed in [Run your first CLI commands](/docs/cli/quick-start).", ""];
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
  if (command.examples !== undefined) lines.push("", "## Examples", "", "```sh", ...command.examples.map((example) => example.replace(/^docture\b/, "npx docture")), "```");
  const samples = transcripts.get(command.name);
  if (samples !== undefined) {
    lines.push("", "## Output examples", "", command.name === "synth list"
      ? "These outputs use a config with one invoice template, its default alias, no custom scenarios, and a digital rendition."
      : "These outputs use the configured invoices dataset with one case, invoice-001, and a deterministic parser experiment. No model runs. Replace the case ID and experiment names with those in your configuration.");
    for (const [index, sample] of samples.entries()) {
      lines.push("", index === 0 ? "### Successful command" : "### Failed command", "", "```sh", `npx docture ${sample.argv.join(" ")}`, "```", "", `Exit code: \`${sample.exitCode}\`.`, "");
      for (const [stream, output] of [["stdout", sample.stdout], ["stderr", sample.stderr]]) {
        if (output === "") lines.push(`\`${stream}\` is empty.`, "");
        else lines.push(`\`${stream}\`:`, "", "```" + (output.trimStart().startsWith("{") ? "json" : "txt"), output.trimEnd(), "```", "");
      }
      if (sample.artifact !== undefined) lines.push(`Written to \`${sample.artifact.path}\`:`, "", "```json", JSON.stringify(sample.artifact.json, null, 2), "```", "");
    }
  }
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
  const content = supportedInstallCommands(lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/(\d)–(\d)/g, "$1 to $2").replace(/\s*[—–]\s*/g, ", ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
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
