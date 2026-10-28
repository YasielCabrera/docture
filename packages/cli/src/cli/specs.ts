/**
 * Every command, every flag, in one place.
 *
 * These specs are what `parseArgs` is configured from AND what `--help` prints, so
 * an undocumented flag is not expressible. Flags are grouped into the sets that
 * genuinely recur — a model, a run — rather than copied per command, because three
 * copies of `--timeout` is three chances for one of them to mean something else.
 */

import type { ConversionAssetMode, CompletionStrategy } from "docture";
import { ENGINE_RANGES } from "../mcp/engines.js";
import type { ChoiceFlagSpec, CommandSpec, FlagSpec, PositionalSpec } from "./args.js";

const OUTPUT_FORMATS = ["json", "ndjson", "text"] as const;
export const CONVERSION_TARGETS = ["md", "html", "txt", "json"] as const;
const ASSET_MODES = ["referenced", "embedded", "omit"] as const satisfies readonly ConversionAssetMode[];
const COMPLETIONS = ["forbidden", "paginate", "concatenate"] as const satisfies readonly CompletionStrategy[];

const FILES: readonly PositionalSpec[] = [
  { name: "file", describe: "Paths, globs, http(s) URLs, or - for stdin", required: true, variadic: true },
];

const DRY_RUN: FlagSpec = {
  name: "dry-run",
  type: "boolean",
  describe: "Validate the invocation and print the plan as JSON. Reads no document and writes no file",
};

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
  { name: "quiet", type: "boolean", short: "q", describe: "Only failures and the first hint per error code on stderr" },
  { name: "no-color", type: "boolean", describe: "Never emit ANSI colour" },
  { name: "help", type: "boolean", short: "h", describe: "Show this help" },
];

export const OUTPUT_FORMAT: ChoiceFlagSpec<(typeof OUTPUT_FORMATS)[number]> = {
  name: "format",
  type: "string",
  placeholder: "<fmt>",
  choices: OUTPUT_FORMATS,
  describe: "JSON is a versioned envelope; NDJSON streams result items",
  defaultLabel: "text",
};

export const COMPLETION: ChoiceFlagSpec<(typeof COMPLETIONS)[number]> = {
  name: "completion",
  type: "string",
  placeholder: "<mode>",
  choices: COMPLETIONS,
  describe: "How a document too big for one request is split",
  defaultLabel: "forbidden",
};

export const CONVERSION_TARGET: ChoiceFlagSpec<(typeof CONVERSION_TARGETS)[number]> = {
  name: "to",
  type: "string",
  placeholder: "<fmt>",
  choices: CONVERSION_TARGETS,
  describe: "Document format to write",
  defaultLabel: "md",
};

export const ASSETS: ChoiceFlagSpec<(typeof ASSET_MODES)[number]> = {
  name: "assets",
  type: "string",
  placeholder: "<mode>",
  choices: ASSET_MODES,
  describe: "How page images and figures are written",
  defaultLabel: "referenced",
};

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
    describe: "JSON prices by model id with inputPerMillion and outputPerMillion; optional cacheReadPerMillion and cacheWritePerMillion default to inputPerMillion",
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
  COMPLETION,
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
    describe: "Overlaps model calls and I/O; local PDF work uses one thread",
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
  positionals: FILES,
  description:
    "Runs the pipeline over every input and writes a JSON envelope to stdout.\n" +
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
    { ...OUTPUT_FORMAT, defaultLabel: "json" },
    {
      name: "full",
      type: "boolean",
      describe:
        "Add method, loader, attempts, usage, features, classification, validation, conflicts, and, with --citations, citations and citationSources to result items",
    },
    {
      name: "citations",
      type: "boolean",
      describe: "Ask the model which document lines show each value, and check them. Needs --full",
    },
    ...MODEL,
    ...RUN,
    DRY_RUN,
    ...COMMON,
  ],
  examples: [
    "docture extract invoice.pdf --schema ./invoice.ts --model openai/gpt-5",
    "docture extract scans/*.pdf -s ./invoice.ts -m openai/gpt-5 --vision -o out/",
    "docture extract invoice.pdf -s ./invoice.ts -m openai/gpt-5 | jq '.results[0].data.total'",
  ],
  notes: [
    "A schema module may export `default`, `schema`, or a single named export.",
    "Point at one export explicitly with `--schema ./schemas.ts#Invoice`.",
  ],
};

export const CONVERT: CommandSpec = {
  name: "convert",
  summary: "Convert PDFs to TXT, Markdown, HTML, or JSON",
  positionals: FILES,
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
    OUTPUT_FORMAT,
    CONVERSION_TARGET,
    ASSETS,
    { name: "pages", type: "string", placeholder: "<n,n,...>", describe: "Convert selected one-based pages, keeping original page numbers" },
    {
      name: "assist-layout",
      type: "boolean",
      describe: "Use --model to refine roles and reading order without changing text",
    },
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    { name: "concurrency", type: "string", placeholder: "<n>", describe: "Overlaps model calls and I/O; local PDF work uses one thread", defaultLabel: "4" },
    ...MODEL,
    DRY_RUN,
    ...COMMON,
  ],
  examples: [
    "docture convert report.pdf --out converted/",
    "docture convert corpus/*.pdf -o converted/ --to html --assets embedded",
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
  positionals: FILES,
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
    OUTPUT_FORMAT,
    ...MODEL.filter((f) => f.name !== "instructions"),
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    { name: "concurrency", type: "string", placeholder: "<n>", describe: "Overlaps model calls and I/O; local PDF work uses one thread", defaultLabel: "4" },
    DRY_RUN,
    ...COMMON,
  ],
  examples: ["docture classify inbox/*.pdf --classifications ./kinds.ts -m openai/gpt-5"],
};

export const INSPECT: CommandSpec = {
  name: "inspect",
  summary: "Show what the loaders see — no model, no API key",
  positionals: FILES,
  description:
    "The answer to “why did no strategy run?”. Loads the document exactly as `extract`\n" +
    "would and prints the features eligibility is decided from.",
  flags: [
    { name: "text", type: "boolean", describe: "Print the extracted text as well" },
    { name: "lines", type: "boolean", describe: "Print positioned lines with their coordinates" },
    OUTPUT_FORMAT,
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
  positionals: FILES,
  description:
    "Extracts each document, scores it field by field, and prints a Markdown\n" +
    "scoreboard. Exits 1 when --min-f1 is not met, so CI can gate on accuracy.",
  flags: [
    OUTPUT_FORMAT,
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
    {
      name: "max-cost-usd",
      type: "string",
      placeholder: "<usd>",
      describe: "Exit 1 if priced total cost exceeds this; requires pricing",
    },
    { name: "calibrate", type: "boolean", describe: "Report experimental empirical OCR field thresholds without applying them" },
    { name: "target-precision", type: "string", placeholder: "<n>", describe: "Calibration target empirical precision in (0,1]", defaultLabel: "0.99" },
    { name: "min-support", type: "string", placeholder: "<n>", describe: "Minimum accepted labelled samples for a candidate threshold", defaultLabel: "5" },
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
    DRY_RUN,
    ...COMMON,
  ],
  examples: [
    "docture eval corpus/*.pdf -s ./invoice.ts -m openai/gpt-5 --truth corpus/truth --min-f1 0.95",
  ],
};

export const MCP: CommandSpec = {
  name: "mcp",
  summary: "Serve convert and inspect to an agent over MCP stdio",
  positionals: [],
  description:
    "Starts a Model Context Protocol server on stdin and stdout. Its convert and inspect\n" +
    "tools return the same version 1 envelope as --format json, and call no model.\n" +
    "Needs the optional peer @modelcontextprotocol/sdk.",
  flags: COMMON.filter((flag) => flag.name !== "verbose" && flag.name !== "quiet"),
  examples: ["docture mcp", "docture mcp --config ./docture.config.ts"],
  notes: [
    "Register it with an MCP host, for example in its JSON server configuration:",
    '  { "mcpServers": { "docture": { "command": "npx", "args": ["docture", "mcp"] } } }',
    "Relative sources resolve against the directory the host starts the server in.",
    `Install the SDK beside the CLI: npm install @modelcontextprotocol/sdk@${ENGINE_RANGES["@modelcontextprotocol/sdk"]}`,
  ],
};

export const REVIEW: CommandSpec = {
  name: "review",
  summary: "Write an offline HTML page that overlays conversion boxes or cited fields on page images",
  positionals: [
    {
      name: "file",
      describe: "The document to convert or extract, a path, http(s) URL, or - for stdin. Omit with --conversion or --extraction",
      required: false,
      variadic: false,
    },
  ],
  description:
    "Draws what docture found over each rendered page, in one self-contained HTML file\n" +
    "that loads nothing from the network. Without --schema or --model it reviews a\n" +
    "conversion; with them it extracts with citations and lists every field beside the\n" +
    "pages, highlighting the lines each field cites.",
  flags: [
    {
      name: "out",
      type: "string",
      short: "o",
      placeholder: "<path>",
      describe: "The HTML file to write",
      defaultLabel: "review.html",
    },
    { name: "dpi", type: "string", placeholder: "<n>", describe: "Page image resolution", defaultLabel: "96" },
    {
      name: "conversion",
      type: "string",
      placeholder: "<path>",
      describe: "Review a saved `convert --to json` file instead of converting. Needs --source",
    },
    {
      name: "extraction",
      type: "string",
      placeholder: "<path>",
      describe: "Review a saved `extract --full` result instead of extracting. Needs --source",
    },
    {
      name: "source",
      type: "string",
      placeholder: "<file>",
      describe: "The original document a saved file came from; its pages are rendered",
    },
    {
      name: "item",
      type: "string",
      placeholder: "<n>",
      describe: "Which result of a saved batch envelope to review, from 0. Required when it holds several",
    },
    {
      name: "schema",
      type: "string",
      short: "s",
      placeholder: "<path>",
      describe: "Extract with this schema and review the cited fields",
    },
    ...MODEL,
    COMPLETION,
    {
      name: "max-chars",
      type: "string",
      placeholder: "<n>",
      describe: "Character budget per request under --completion concatenate",
      defaultLabel: "24000",
    },
    { name: "timeout", type: "string", placeholder: "<ms>", describe: "Per-stage deadline. Omit for none" },
    DRY_RUN,
    ...COMMON,
  ],
  examples: [
    "docture review report.pdf -o review.html",
    "docture review --conversion report.json --source report.pdf",
    "docture review invoice.pdf --schema ./invoice.ts --model openai/gpt-5",
    "docture review --extraction results.json --source invoice.pdf --item 0",
  ],
  notes: [
    "Pages are rendered with the configured loaders, or PDF.js and @napi-rs/canvas by default.",
    "Saved conversion JSON and extraction results are validated before any page is rendered.",
  ],
};

export const SERVE: CommandSpec = {
  name: "serve",
  summary: "Serve byte-based convert, inspect and configured-schema extract over HTTP",
  positionals: [],
  description: "Keeps configured loaders and clients warm. Binds to localhost by default. Non-loopback binding requires DOCTURE_SERVE_TOKEN.",
  flags: [
    { name: "host", type: "string", describe: "Address to bind", defaultLabel: "127.0.0.1" },
    { name: "port", type: "string", describe: "Port to bind; 0 selects an ephemeral port", defaultLabel: "8787" },
    { name: "schema", type: "string", multiple: true, placeholder: "<name=module>", describe: "Allow a named schema; a plain module uses default" },
    { name: "concurrency", type: "string", describe: "Maximum active requests", defaultLabel: "4" },
    { name: "max-queue", type: "string", describe: "Maximum queued requests", defaultLabel: "16" },
    { name: "max-body-bytes", type: "string", describe: "Maximum encoded JSON request bytes", defaultLabel: "16777216" },
    { name: "body-timeout", type: "string", describe: "Request body deadline in milliseconds", defaultLabel: "30000" },
    { name: "shutdown-timeout", type: "string", describe: "Drain deadline before aborting active work", defaultLabel: "30000" },
    ...MODEL,
    ...COMMON,
  ],
  examples: ["docture serve --port 8787 --schema invoice=./invoice.ts"],
};

export const PAPERLESS: CommandSpec = {
  name: "paperless",
  summary: "Read, extract, plan and explicitly apply configured Paperless mappings",
  positionals: [
    { name: "action", describe: "read, search, extract, plan or apply", required: true, variadic: false },
    { name: "source", describe: "Document ID, or saved plan path for apply", required: false, variadic: false },
  ],
  description: "Uses the configured Paperless instance and named schemas. Credentials and mappings cannot be replaced by command arguments.",
  flags: [
    { name: "schema", type: "string", placeholder: "<name>", describe: "Configured schema and mapping name" },
    { name: "query", type: "string", describe: "Bounded native document query" },
    { name: "limit", type: "string", describe: "Maximum query results within the configured bound" },
    { name: "version", type: "string", describe: "Selected file-version ID" },
    { name: "out", type: "string", short: "o", describe: "Save the returned artifact to this path" },
    { name: "dry-run", type: "boolean", describe: "Print the proposed plan and perform no Paperless writes" },
    ...COMMON,
  ],
  examples: ["docture paperless plan 42 --schema invoice", "docture paperless apply plan.json --schema invoice --dry-run"],
};

export const COMMANDS: readonly CommandSpec[] = [EXTRACT, CONVERT, CLASSIFY, INSPECT, EVAL, REVIEW, MCP, SERVE, PAPERLESS];

/** Reserved on the help route only, so `extract --json` stays an unknown option. */
export const HELP_JSON: FlagSpec = {
  name: "json",
  type: "boolean",
  describe: "Print the command and flag specs as a JSON envelope",
};

/** `docture help [command]`, parsed like a command but not listed as one. */
export const HELP: CommandSpec = {
  name: "help",
  summary: "Show help for every command, or for one",
  positionals: [{ name: "command", describe: "The command to describe", required: false, variadic: false }],
  flags: [HELP_JSON, ...COMMON.filter((flag) => flag.name === "no-color" || flag.name === "help")],
};

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
