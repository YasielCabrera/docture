/**
 * Every command, every flag, in one place.
 *
 * These specs are what `parseArgs` is configured from AND what `--help` prints, so
 * an undocumented flag is not expressible. Flags are grouped into the sets that
 * genuinely recur — a model, a run — rather than copied per command, because three
 * copies of `--timeout` is three chances for one of them to mean something else.
 */

import type { CommandSpec, FlagSpec } from "./args.js";

/** Present on every command. */
const COMMON: readonly FlagSpec[] = [
  {
    name: "config",
    type: "string",
    placeholder: "<path>",
    describe: "Config file. Default: the nearest docture.config.{ts,mts,js,mjs}",
  },
  { name: "no-config", type: "boolean", describe: "Ignore any config file that is found" },
  {
    name: "verbose",
    type: "boolean",
    short: "v",
    describe: "Report the wiring, the routing, and every attempt",
  },
  { name: "quiet", type: "boolean", short: "q", describe: "Errors only on stderr" },
  { name: "no-color", type: "boolean", describe: "Never emit ANSI colour" },
  { name: "help", type: "boolean", short: "h", describe: "Show this help" },
];

/** Choosing and paying for a model. */
const MODEL: readonly FlagSpec[] = [
  {
    name: "model",
    type: "string",
    short: "m",
    placeholder: "<provider/id>",
    describe: "The AI SDK model, e.g. openai/gpt-5 or anthropic/claude-opus-5",
  },
  {
    name: "gateway",
    type: "boolean",
    describe: "Route through the Vercel AI Gateway even if the provider package is installed",
  },
  {
    name: "pricing",
    type: "string",
    placeholder: "<path>",
    describe: "JSON of { \"model-id\": { inputPerMillion, outputPerMillion } } — enables cost reporting",
  },
  {
    name: "cache",
    type: "string",
    placeholder: "<dir>",
    describe: "Cache model responses on disk, so a re-run is free",
  },
  {
    name: "instructions",
    type: "string",
    placeholder: "<text>",
    describe: "Domain guidance appended to the system prompt",
  },
  {
    name: "temperature",
    type: "string",
    placeholder: "<n>",
    describe: "Sampling temperature",
    defaultLabel: "0",
  },
];

/** How the pipeline runs, independent of which model it uses. */
const RUN: readonly FlagSpec[] = [
  {
    name: "vision",
    type: "boolean",
    describe: "Render pages and add a vision strategy — this is what reads a scan",
  },
  { name: "dpi", type: "string", placeholder: "<n>", describe: "Render resolution for --vision", defaultLabel: "200" },
  {
    name: "max-pages",
    type: "string",
    placeholder: "<n>",
    describe: "Send at most this many page images to the model, under --vision",
  },
  {
    name: "completion",
    type: "string",
    placeholder: "<mode>",
    describe: "forbidden | paginate | concatenate — how a document too big for one request is split",
    defaultLabel: "forbidden",
  },
  {
    name: "max-chars",
    type: "string",
    placeholder: "<n>",
    describe: "Character budget per request under --completion concatenate",
    defaultLabel: "24000",
  },
  {
    name: "timeout",
    type: "string",
    placeholder: "<ms>",
    describe: "Per-stage deadline. Omit for none",
  },
  {
    name: "concurrency",
    type: "string",
    placeholder: "<n>",
    describe: "Documents in flight at once",
    defaultLabel: "4",
  },
  {
    name: "only",
    type: "string",
    multiple: true,
    placeholder: "<strategy>",
    describe: "Restrict to these strategies, in this order. Repeatable",
  },
  {
    name: "classify",
    type: "boolean",
    describe: "Classify with the model first, and prompt with what it decided",
  },
  {
    name: "classifications",
    type: "string",
    placeholder: "<path>",
    describe: "Module exporting the candidate document kinds",
  },
];

export const EXTRACT: CommandSpec = {
  name: "extract",
  summary: "Extract structured data from one or many documents",
  args: "<file...>",
  description:
    "Runs the pipeline over every input and writes the extracted data to stdout.\n" +
    "Diagnostics go to stderr, so the output stays pipeable.",
  flags: [
    {
      name: "schema",
      type: "string",
      short: "s",
      placeholder: "<path>",
      describe: "Module exporting a Zod/Valibot/ArkType schema, or a .json JSON Schema",
    },
    {
      name: "out",
      type: "string",
      short: "o",
      placeholder: "<path>",
      describe: "Write to a file — or, with several inputs, to a directory",
    },
    {
      name: "format",
      type: "string",
      placeholder: "<fmt>",
      describe: "json | ndjson. ndjson streams one line per document as it finishes",
      defaultLabel: "json",
    },
    {
      name: "full",
      type: "boolean",
      describe: "Emit the whole result — method, loader, attempts, usage, features — not just the data",
    },
    ...MODEL,
    ...RUN,
    ...COMMON,
  ],
  examples: [
    "docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5",
    "docture extract scans/*.pdf -s ./invoice.ts -m openai/gpt-5 --vision -o out/",
    "docture extract invoice.pdf -s ./invoice.ts -m openai/gpt-5 | jq .total",
  ],
  notes: [
    "A schema module may export `default`, `schema`, or a single named export.",
    "Point at one export explicitly with `--schema ./schemas.ts#Invoice`.",
  ],
};

export const CONVERT: CommandSpec = {
  name: "convert",
  summary: "Convert PDFs to TXT, Markdown, or HTML",
  args: "<file...>",
  description:
    "Recovers grounded document text and layout for indexing and RAG. Outputs and\n" +
    "referenced images are written beneath the required --out directory.",
  flags: [
    {
      name: "out",
      type: "string",
      short: "o",
      placeholder: "<directory>",
      describe: "Output directory. Required",
    },
    {
      name: "format",
      type: "string",
      placeholder: "<fmt>",
      describe: "md | html | txt",
      defaultLabel: "md",
    },
    {
      name: "assets",
      type: "string",
      placeholder: "<mode>",
      describe: "referenced | embedded | omit",
      defaultLabel: "referenced",
    },
    {
      name: "assist-layout",
      type: "boolean",
      describe: "Use --model to refine roles and reading order without changing text",
    },
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    { name: "concurrency", type: "string", placeholder: "<n>", describe: "Documents in flight at once", defaultLabel: "4" },
    ...MODEL,
    ...COMMON,
  ],
  examples: [
    "docture convert report.pdf --out converted/",
    "docture convert corpus/*.pdf -o converted/ --format html --assets embedded",
    "docture convert report.pdf -o converted/ --assist-layout -m openai/gpt-5",
  ],
  notes: [
    "The default PDF.js loader reads digital PDFs. Configure an OCR loader explicitly for scans.",
    "Model assistance can classify and reorder known elements, but its schema contains no text field.",
  ],
};

export const CLASSIFY: CommandSpec = {
  name: "classify",
  summary: "Decide what kind of document this is, without extracting",
  args: "<file...>",
  description:
    "Reads each document and asks the classifiers what it is. Cheap next to a full\n" +
    "extraction, and the way to check a routing decision before paying for one.",
  flags: [
    {
      name: "classifications",
      type: "string",
      placeholder: "<path>",
      describe: "Module exporting the candidate document kinds. Required unless the config supplies them",
    },
    { name: "json", type: "boolean", describe: "Emit JSON rather than a table" },
    ...MODEL.filter((f) => f.name !== "instructions"),
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    { name: "concurrency", type: "string", placeholder: "<n>", describe: "Documents in flight at once", defaultLabel: "4" },
    ...COMMON,
  ],
  examples: ["docture classify inbox/*.pdf --classifications ./kinds.ts -m openai/gpt-5"],
};

export const INSPECT: CommandSpec = {
  name: "inspect",
  summary: "Show what the loaders see — no model, no API key",
  args: "<file...>",
  description:
    "The answer to “why did no strategy run?”. Loads the document exactly as `extract`\n" +
    "would and prints the features eligibility is decided from.",
  flags: [
    { name: "text", type: "boolean", describe: "Print the extracted text as well" },
    { name: "lines", type: "boolean", describe: "Print positioned lines with their coordinates" },
    { name: "json", type: "boolean", describe: "Emit JSON rather than a report" },
    {
      name: "pages",
      type: "string",
      placeholder: "<n>",
      describe: "Only report on the first n pages",
    },
    { name: "vision", type: "boolean", describe: "Also check that pages can be rendered" },
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    ...COMMON,
  ],
  examples: ["docture inspect statement.pdf", "docture inspect scan.pdf --text"],
};

export const EVAL: CommandSpec = {
  name: "eval",
  summary: "Score extractions against ground truth",
  args: "<file...>",
  description:
    "Extracts each document, scores it field by field, and prints a Markdown\n" +
    "scoreboard. Exits 1 when --min-f1 is not met, so CI can gate on accuracy.",
  flags: [
    {
      name: "schema",
      type: "string",
      short: "s",
      placeholder: "<path>",
      describe: "Module exporting a schema, or a .json JSON Schema",
    },
    {
      name: "truth",
      type: "string",
      placeholder: "<path>",
      describe: "Ground truth: a directory of <name>.json, or one file for one input",
      defaultLabel: "<name>.expected.json beside each input",
    },
    {
      name: "min-f1",
      type: "string",
      placeholder: "<n>",
      describe: "Exit 1 if the mean F1 falls below this",
    },
    { name: "report", type: "string", placeholder: "<path>", describe: "Write the scoreboard here too" },
    {
      name: "align-by",
      type: "string",
      placeholder: "<field>",
      describe: "Match array elements by this field instead of by position",
    },
    {
      name: "tolerance",
      type: "string",
      placeholder: "<n>",
      describe: "Absolute tolerance for numbers",
      defaultLabel: "0.01",
    },
    {
      name: "string-similarity",
      type: "string",
      placeholder: "<n>",
      describe: "Minimum similarity, 0–1, for two strings to count as equal",
      defaultLabel: "0.9",
    },
    ...MODEL,
    ...RUN,
    ...COMMON,
  ],
  examples: [
    "docture eval corpus/*.pdf -s ./invoice.ts -m openai/gpt-5 --truth corpus/truth --min-f1 0.95",
  ],
};

export const COMMANDS: readonly CommandSpec[] = [EXTRACT, CONVERT, CLASSIFY, INSPECT, EVAL];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
