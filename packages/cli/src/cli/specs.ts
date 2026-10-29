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

const EVAL_CONFIG: FlagSpec = {
  name: "config",
  type: "string",
  placeholder: "<path>",
  describe: "Eval config. Default: the nearest docture.eval.{ts,mts,js,mjs}",
};

const EVAL_COMMON: readonly FlagSpec[] = COMMON.map((flag) => (flag.name === "config" ? EVAL_CONFIG : flag))
  .filter((flag) => flag.name !== "no-config");

const STORE: FlagSpec = {
  name: "store",
  type: "string",
  placeholder: "<dir>",
  describe: "Run store directory. Default: the config's store, else .docture/eval beside the config",
};

const EVAL_FORMATS = ["text", "json"] as const;
const EVAL_FORMAT: ChoiceFlagSpec<(typeof EVAL_FORMATS)[number]> = {
  name: "format",
  type: "string",
  placeholder: "<fmt>",
  choices: EVAL_FORMATS,
  describe: "Text for people; JSON prints the eval result or record as is",
  defaultLabel: "text",
};

const COMPARE_FORMATS = ["md", "json"] as const;
export const COMPARE_FORMAT: ChoiceFlagSpec<(typeof COMPARE_FORMATS)[number]> = {
  name: "format",
  type: "string",
  placeholder: "<fmt>",
  choices: COMPARE_FORMATS,
  describe: "Markdown tables, or the comparison as JSON",
  defaultLabel: "md",
};

const COMPARE_TESTS = ["auto", "bootstrap", "mcnemar"] as const;
export const COMPARE_TEST: ChoiceFlagSpec<(typeof COMPARE_TESTS)[number]> = {
  name: "test",
  type: "string",
  placeholder: "<test>",
  choices: COMPARE_TESTS,
  describe: "Significance test: paired bootstrap for continuous metrics, McNemar for binary ones",
  defaultLabel: "auto",
};

const REPORTER: FlagSpec = {
  name: "reporter",
  type: "string",
  multiple: true,
  placeholder: "<names>",
  describe:
    "Comma-separated terminal, html, md, json, csv, junit, or a module path. Replaces the config's reporters. Repeatable",
};

const OUT: FlagSpec = {
  name: "out",
  type: "string",
  placeholder: "<dir>",
  describe: "Directory reporters write into",
  defaultLabel: "eval-report",
};

const EXPERIMENT: FlagSpec = {
  name: "experiment",
  type: "string",
  placeholder: "<ids>",
  describe: "Comma-separated experiment ids from the config. Default: all",
};

const STRATA: FlagSpec = {
  name: "strata",
  type: "string",
  placeholder: "<path>",
  describe: "Stratify the sample by a case path, such as tags.rendition or group",
};

const SEED: FlagSpec = { name: "seed", type: "string", placeholder: "<text>", describe: "Sample seed", defaultLabel: "none" };

/** Flags of config mode only. Quick mode rejects them. */
export const EVAL_CONFIG_FLAGS = ["experiment", "sample", "strata", "seed", "cases", "epochs", "resume", "baseline", "store"] as const;
/** Flags of quick mode only. Config mode rejects them. */
export const EVAL_QUICK_FLAGS = [
  "schema", "truth", "min-f1", "max-cost-usd", "calibrate", "target-precision", "min-support", "report", "align-by",
  "tolerance", "string-similarity", "dry-run", ...MODEL.map((flag) => flag.name), ...RUN.map((flag) => flag.name).filter((name) => name !== "concurrency"),
] as const;

export const EVAL_RUN: CommandSpec = {
  name: "eval run",
  summary: "Run an evaluation from docture.eval.ts, or score files against ground truth",
  positionals: [
    { name: "file", describe: "Quick mode: documents to extract and score. Omit to run docture.eval.ts", required: false, variadic: true },
  ],
  description:
    "Without files, loads docture.eval.ts, runs every experiment over the dataset, stores the\n" +
    "run, writes the reporters, prints the scoreboard and applies the gate.\n" +
    "With files, quick mode extracts each one through docture.config.ts and scores it against\n" +
    "its ground truth with loose comparisons. Exits 1 when a gate fails.",
  flags: [
    {
      ...OUTPUT_FORMAT,
      describe: "Text prints the scoreboard. JSON prints the eval result, or the document envelope in quick mode. NDJSON streams rows",
    },
    EXPERIMENT,
    { name: "sample", type: "string", placeholder: "<n>", describe: "Run a deterministic stratified sample of n cases" },
    STRATA,
    SEED,
    { name: "cases", type: "string", placeholder: "<ids>", describe: "Comma-separated case ids to run" },
    { name: "epochs", type: "string", placeholder: "<n>", describe: "Run every case n times", defaultLabel: "1" },
    { name: "resume", type: "string", placeholder: "<runId|latest>", describe: "Continue an unfinished run, reusing its finished cases" },
    { name: "baseline", type: "string", placeholder: "<runId|auto|none>", describe: "Compare against this run. auto: the latest complete run of the dataset" },
    REPORTER,
    OUT,
    { name: "no-gate", type: "boolean", describe: "Skip the gate. The run still records every metric" },
    STORE,
    {
      name: "schema",
      type: "string",
      short: "s",
      placeholder: "<path>",
      describe: "Quick mode: module exporting a schema, or a .json JSON Schema",
    },
    {
      name: "truth",
      type: "string",
      placeholder: "<path>",
      describe: "Quick mode: a directory of <name>.json, or one file for one input",
      defaultLabel: "<name>.expected.json beside each input",
    },
    { name: "min-f1", type: "string", placeholder: "<n>", describe: "Quick mode: gate on a minimum mean document F1" },
    { name: "max-cost-usd", type: "string", placeholder: "<usd>", describe: "Quick mode: gate on the priced total cost; requires pricing" },
    { name: "calibrate", type: "boolean", describe: "Quick mode: add an OCR confidence calibration report" },
    { name: "target-precision", type: "string", placeholder: "<n>", describe: "Calibration target precision in (0,1]", defaultLabel: "0.99" },
    { name: "min-support", type: "string", placeholder: "<n>", describe: "Minimum fields behind a calibration threshold", defaultLabel: "5" },
    { name: "report", type: "string", placeholder: "<path>", describe: "Quick mode: write the scoreboard here too" },
    { name: "align-by", type: "string", placeholder: "<field>", describe: "Quick mode: match array elements by this field instead of by position" },
    { name: "tolerance", type: "string", placeholder: "<n>", describe: "Quick mode: absolute tolerance for numbers", defaultLabel: "0.01" },
    {
      name: "string-similarity",
      type: "string",
      placeholder: "<n>",
      describe: "Quick mode: minimum similarity, 0–1, for two strings to count as equal",
      defaultLabel: "0.9",
    },
    ...MODEL,
    ...RUN,
    DRY_RUN,
    ...COMMON.map((flag) => (flag.name === "config" ? { ...EVAL_CONFIG, describe: `${EVAL_CONFIG.describe}. In quick mode, docture.config.ts` } : flag)),
  ],
  examples: [
    "docture eval run",
    "docture eval run --experiment llm --sample 60 --strata tags.rendition --reporter html,junit",
    "docture eval run --resume latest",
    "docture eval run corpus/*.pdf -s ./invoice.ts -m openai/gpt-5 --truth corpus/truth --min-f1 0.95",
  ],
  notes: [
    "Quick mode also runs without the subcommand: docture eval corpus/*.pdf -s ./invoice.ts.",
    "Reporters write into --out: report.html, report.md, result.json, cases.csv, junit.xml.",
    "A module reporter exports a Reporter (default or `reporter`) or a function (result) => string,",
    "  written to <out>/<module name>.txt or to the module's exported `fileName`.",
    "The terminal scoreboard always prints in text format; listing `terminal` changes nothing.",
    "A run without a configured gate exits 0 and says that no gate ran.",
  ],
};

export const EVAL_REPORT: CommandSpec = {
  name: "eval report",
  summary: "Re-render a stored run in any format, without running anything",
  positionals: [{ name: "run", describe: "A run id, latest, or a directory holding result.json", required: true, variadic: false }],
  flags: [
    { name: "rescore", type: "boolean", describe: "Score the stored raw outputs again with the config's current spec as a new run" },
    REPORTER,
    OUT,
    EVAL_FORMAT,
    STORE,
    ...EVAL_COMMON,
  ],
  examples: ["docture eval report latest --reporter html,md", "docture eval report .docture/eval/runs/<runId> --format json"],
};

export const EVAL_COMPARE: CommandSpec = {
  name: "eval compare",
  summary: "Compare two runs with paired significance tests",
  positionals: [
    { name: "base", describe: "Baseline run id or run directory", required: true, variadic: false },
    { name: "candidate", describe: "Candidate run id or run directory", required: true, variadic: false },
  ],
  flags: [
    COMPARE_TEST,
    COMPARE_FORMAT,
    { name: "experiment", type: "string", placeholder: "<id|base:candidate>", describe: "One experiment, or a baseline and candidate pair. Default: every shared experiment" },
    STORE,
    ...EVAL_COMMON,
  ],
  examples: ["docture eval compare <baseRunId> latest", "docture eval compare base/ candidate/ --test mcnemar --format json"],
};

export const EVAL_GATE: CommandSpec = {
  name: "eval gate",
  summary: "Apply the config's gate to a stored run",
  positionals: [{ name: "run", describe: "A run id, latest, or a run directory", required: true, variadic: false }],
  flags: [
    { name: "baseline", type: "string", placeholder: "<runId|auto|none>", describe: "Compare first, so regression budgets apply", defaultLabel: "the run's stored comparison" },
    EVAL_FORMAT,
    STORE,
    ...EVAL_COMMON,
  ],
  examples: ["docture eval gate latest --baseline auto"],
};

export const EVAL_RUNS: CommandSpec = {
  name: "eval runs",
  summary: "List stored runs, newest first",
  positionals: [],
  flags: [EVAL_FORMAT, STORE, ...EVAL_COMMON],
};

export const EVAL_VALIDATE: CommandSpec = {
  name: "eval validate",
  summary: "Check every case's ground truth against the spec and list all problems",
  positionals: [],
  flags: EVAL_COMMON,
};

export const EVAL_SAMPLE: CommandSpec = {
  name: "eval sample",
  summary: "Print the case ids of a deterministic stratified sample",
  positionals: [],
  flags: [{ name: "size", type: "string", placeholder: "<n>", describe: "Number of cases. Required" }, STRATA, SEED, ...EVAL_COMMON],
  examples: ["docture eval sample --size 60 --strata tags.rendition"],
};

export const EVAL_MIGRATE: CommandSpec = {
  name: "eval migrate",
  summary: "Preview or apply a ground-truth migration",
  positionals: [{ name: "migration", describe: "Module exporting a migration (default or `migration`)", required: true, variadic: false }],
  flags: [{ name: "write", type: "boolean", describe: "Write the changes. Default: print them only" }, ...EVAL_COMMON],
  examples: ["docture eval migrate ./migrations/net-totals.ts", "docture eval migrate ./migrations/net-totals.ts --write"],
};

export const EVAL_DRAFT: CommandSpec = {
  name: "eval draft",
  summary: "Draft ground truth for cases without signed-off truth",
  positionals: [],
  flags: [{ ...EXPERIMENT, describe: "The experiment that drafts. Required when the config has several" }, ...EVAL_COMMON],
};

export const EVAL_SIGN_OFF: CommandSpec = {
  name: "eval sign-off",
  summary: "Mark a case's drafted ground truth as reviewed",
  positionals: [{ name: "case", describe: "Case id", required: true, variadic: false }],
  flags: EVAL_COMMON,
};

export const EVAL: CommandSpec = {
  name: "eval",
  summary: "Evaluate extraction quality: run, report, compare and gate",
  positionals: [{ name: "command", describe: "A subcommand. Default: run", required: false, variadic: false }],
  description:
    "Runs the evaluation in docture.eval.ts and works with the runs it stores. Every\n" +
    "subcommand is a thin shell over @docture/eval. Files without a subcommand run quick mode.",
  flags: COMMON.filter((flag) => flag.name === "help" || flag.name === "no-color"),
  subcommands: [EVAL_RUN, EVAL_REPORT, EVAL_COMPARE, EVAL_GATE, EVAL_RUNS, EVAL_VALIDATE, EVAL_SAMPLE, EVAL_MIGRATE, EVAL_DRAFT, EVAL_SIGN_OFF],
  examples: [
    "docture eval run",
    "docture eval compare <baseRunId> latest",
    "docture eval corpus/*.pdf -s ./invoice.ts -m openai/gpt-5 --truth corpus/truth --min-f1 0.95",
  ],
  notes: [
    "Exit codes: 0 pass, 1 gate failed or a run failed, 2 usage error.",
    "`docture eval <command> --help` describes one subcommand.",
  ],
};

const SYNTH_COMMON: readonly FlagSpec[] = COMMON.filter((flag) => flag.name !== "no-config").map((flag) =>
  flag.name === "config" ? { ...flag, describe: "Synth config. Default: the nearest docture.synth.{ts,mts,js,mjs}" } : flag,
);

const SYNTH_SEED: FlagSpec = { name: "seed", type: "string", placeholder: "<seed>", describe: "Sample seed. Digits are a number, anything else a string. Required" };
const SYNTH_SCENARIO: FlagSpec = { name: "scenario", type: "string", placeholder: "<name>", describe: "A scenario from the config", defaultLabel: "base" };
const NO_VERIFY: FlagSpec = { name: "no-verify", type: "boolean", describe: "Skip reading each digital rendering back to confirm its labels" };

const LIST_FORMATS = ["text", "json"] as const;
export const LIST_FORMAT: ChoiceFlagSpec<(typeof LIST_FORMATS)[number]> = {
  name: "format",
  type: "string",
  placeholder: "<fmt>",
  choices: LIST_FORMATS,
  describe: "Text for people; JSON for scripts",
  defaultLabel: "text",
};

export const SYNTH_LIST: CommandSpec = {
  name: "synth list",
  summary: "List the config's templates, scenarios and the rendition profiles",
  positionals: [],
  flags: [LIST_FORMAT, ...SYNTH_COMMON],
};

export const SYNTH_GEN: CommandSpec = {
  name: "synth gen",
  summary: "Print one sampled value as JSON",
  positionals: [],
  flags: [SYNTH_SEED, SYNTH_SCENARIO, ...SYNTH_COMMON],
  examples: ["docture synth gen --seed 7", "docture synth gen --seed 7 --scenario many-items | jq .totalCents"],
};

export const SYNTH_RENDER: CommandSpec = {
  name: "synth render",
  summary: "Render one document with its labels",
  positionals: [],
  flags: [
    { name: "template", type: "string", placeholder: "<selector>", describe: "Template key or alias. Required when the config has several" },
    SYNTH_SEED,
    SYNTH_SCENARIO,
    { name: "rendition", type: "string", placeholder: "<rendition>", describe: "digital, or scan, scan-lq, photo or fax with a severity, such as photo:0.6", defaultLabel: "digital" },
    { name: "out", type: "string", placeholder: "<file>", describe: "Document path. Labels go to <file>.labels.json. Required" },
    NO_VERIFY,
    ...SYNTH_COMMON,
  ],
  examples: ["docture synth render --seed 7 --out invoice.pdf", "docture synth render --template classic --seed 7 --rendition photo:0.6 --out photo.pdf"],
  notes: ["The digital rendering is verified before it is degraded, so a degraded document's labels come from verified ones."],
};

export const SYNTH_CORPUS: CommandSpec = {
  name: "synth corpus",
  summary: "Write a labeled corpus that @docture/eval's jsonlDataset reads",
  positionals: [],
  flags: [
    { name: "out", type: "string", placeholder: "<dir>", describe: "Corpus directory. Default: the config's out, else corpus beside the config" },
    { name: "seeds", type: "string", placeholder: "<seeds>", describe: "A range such as 1-40, a list such as 1,2,3, or both. Default: the config's seeds" },
    { name: "templates", type: "string", multiple: true, placeholder: "<selectors>", describe: "Comma-separated template keys, aliases or families. Default: all" },
    { name: "scenarios", type: "string", multiple: true, placeholder: "<names>", describe: "Comma-separated scenarios; base is the unvaried model. Default: base and every configured scenario" },
    { name: "renditions", type: "string", multiple: true, placeholder: "<list>", describe: "Comma-separated renditions such as digital,scan:0.3. Default: the config's, else digital" },
    { name: "concurrency", type: "string", placeholder: "<n>", describe: "Renderings in flight at once", defaultLabel: "4" },
    NO_VERIFY,
    ...SYNTH_COMMON,
  ],
  examples: ["docture synth corpus", "docture synth corpus --seeds 1-40 --renditions digital,scan:0.3,photo:0.6 --out corpus"],
  notes: [
    "Rerunning converges: a case whose inputs and files are unchanged is skipped.",
    "A case that fails is listed on stderr and in failures.jsonl, and the command exits 1.",
  ],
};

export const SYNTH_VERIFY: CommandSpec = {
  name: "synth verify",
  summary: "Read every digital case of a corpus back and confirm its labels",
  positionals: [{ name: "corpus", describe: "A directory written by docture synth corpus", required: true, variadic: false }],
  flags: COMMON.filter((flag) => ["verbose", "quiet", "no-color", "help"].includes(flag.name)),
  examples: ["docture synth verify corpus"],
};

export const SYNTH: CommandSpec = {
  name: "synth",
  summary: "Generate labeled synthetic documents from docture.synth.ts",
  positionals: [{ name: "command", describe: "A subcommand", required: true, variadic: false }],
  description:
    "Samples values from the model in docture.synth.ts, renders them with its templates and\n" +
    "writes each document with its ground truth and field boxes. Every subcommand is a thin\n" +
    "shell over @docture/synthetic. Rendering needs pdfkit, degraded renditions sharp, and\n" +
    "verification the CLI's PDF.js.",
  flags: COMMON.filter((flag) => flag.name === "help" || flag.name === "no-color"),
  subcommands: [SYNTH_LIST, SYNTH_GEN, SYNTH_RENDER, SYNTH_CORPUS, SYNTH_VERIFY],
  examples: ["docture synth list", "docture synth render --seed 7 --out invoice.pdf", "docture synth corpus --seeds 1-40"],
  notes: [
    "Exit codes: 0 done, 1 a case failed to render or verify, 2 usage error.",
    "`docture synth <command> --help` describes one subcommand.",
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

export const COMMANDS: readonly CommandSpec[] = [EXTRACT, CONVERT, CLASSIFY, INSPECT, EVAL, SYNTH, REVIEW, MCP, SERVE, PAPERLESS];

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
  positionals: [{ name: "command", describe: "The command to describe, such as eval run", required: false, variadic: true }],
  flags: [HELP_JSON, ...COMMON.filter((flag) => flag.name === "no-color" || flag.name === "help")],
};

/** A command, or a subcommand by its full name such as `eval run`. */
export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.flatMap((c) => [c, ...(c.subcommands ?? [])]).find((c) => c.name === name);
}
