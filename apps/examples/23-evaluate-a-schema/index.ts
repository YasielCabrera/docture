import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { contract, defineStrategy, DocumentLoaderData, Extractor } from "docture";
import { llm } from "docture/llm";
import { date, defineEval, defineReporter, exact, hungarian, number, type Dataset, type EvalResult, type Reporter } from "@docture/eval";
import { fromDocture } from "@docture/eval/docture";
import { fileDocument } from "@docture/eval/node";
import { jsonReporter } from "@docture/eval/reporters/json";
import { junitReporter } from "@docture/eval/reporters/junit";
import { markdownReporter } from "@docture/eval/reporters/markdown";
import { renderScoreboard } from "@docture/eval/reporters/terminal";
import { memoryRunStore, runEval } from "@docture/eval/runner";
import { z } from "zod";
import { field, heading, note, step } from "../shared/print.js";
import { isMain, run } from "../shared/run.js";

const Flag = z.enum(["low", "normal", "high"]);
const LabReportSchema = z.object({
  patientId: z.string(),
  collectedOn: z.string().describe("The collection date, YYYY-MM-DD"),
  results: z.array(z.object({ analyte: z.string(), value: z.number(), unit: z.string(), flag: Flag })),
});
export type LabReportData = z.infer<typeof LabReportSchema>;

export const LabReport = contract({
  name: "lab-report",
  description: "One laboratory report: the patient, the collection date and every result.",
  schema: LabReportSchema,
});

export const labReportSpec = defineEval(LabReport, {
  strings: exact({ normalize: "case-and-whitespace" }),
  fields: {
    patientId: { compare: exact(), critical: true },
    collectedOn: date(),
    "results[].value": number({ rel: 0.001 }),
  },
  arrays: { results: hungarian({ key: ["analyte"] }) },
  segments: { patient: ["patientId", "collectedOn"], results: "results" },
});

interface ManifestEntry {
  readonly id: string;
  readonly report: string;
  readonly truth: string;
  readonly lab: string;
  readonly patient: string;
}

export const LAB_REPORTS = fileURLToPath(new URL("./lab-reports/", import.meta.url));

export function manifestDataset(dir: string): Dataset<LabReportData> {
  return {
    id: "lab-reports",
    async cases() {
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { readonly cases: readonly ManifestEntry[] };
      return Promise.all(
        manifest.cases.map(async (entry) => ({
          id: entry.id,
          documents: [fileDocument(join(dir, entry.report))],
          expected: LabReportSchema.parse(JSON.parse(await readFile(join(dir, entry.truth), "utf8"))),
          tags: { lab: entry.lab },
          group: entry.patient,
        })),
      );
    },
  };
}

const FLAGS: Readonly<Record<string, z.infer<typeof Flag>>> = {
  L: "low",
  N: "normal",
  H: "high",
  low: "low",
  normal: "normal",
  high: "high",
};
const NORTH_ROW = /^(\w+) ([\d.]+) (\S+) ([LNH])$/;
const SOUTH_ROW = /^Analyte: (\w+) \| Result: ([\d.]+) (\S+) \| Flag: (\w+)$/;

export function readReport(text: string, options: { readonly parseSouthgateFlags: boolean }): LabReportData {
  const results = text
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const north = NORTH_ROW.exec(line);
      if (north !== null) {
        const [, analyte = "", value = "", unit = "", flag = ""] = north;
        return [{ analyte, value: Number(value), unit, flag: FLAGS[flag] ?? "normal" }];
      }
      const south = SOUTH_ROW.exec(line);
      if (south !== null) {
        const [, analyte = "", value = "", unit = "", flag = ""] = south;
        return [{ analyte, value: Number(value), unit, flag: options.parseSouthgateFlags ? (FLAGS[flag] ?? "normal") : "normal" }];
      }
      return [];
    });
  return {
    patientId: /P-\d{4}/.exec(text)?.[0] ?? "",
    collectedOn: /Collected: (\S+)/.exec(text)?.[1] ?? /collected (.+?) for patient/.exec(text)?.[1] ?? "",
    results,
  };
}

function parserExtractor(version: 1 | 2): Extractor {
  return new Extractor().loadDocumentLoader(new DocumentLoaderData()).loadStrategy(
    defineStrategy({
      name: `lab-parser-v${version}`,
      requires: ["TEXT_LAYER"],
      async extract(context) {
        return { data: readReport(context.document.text, { parseSouthgateFlags: version === 2 }) };
      },
    }),
  );
}

function mockReaderWithDecimalPointShift(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: "mock-reader",
    provider: "mock",
    async doGenerate(options) {
      const text = options.prompt
        .flatMap((message) =>
          typeof message.content === "string"
            ? [message.content]
            : message.content.flatMap((part) => ("text" in part && typeof part.text === "string" ? [part.text] : [])),
        )
        .join("\n");
      const report = readReport(text, { parseSouthgateFlags: true });
      const answer = text.includes("Southgate")
        ? { ...report, results: report.results.map((row, index) => (index === 0 ? { ...row, value: row.value * 10 } : row)) }
        : report;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 120, text: 120, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

const PRICING = { "mock-reader": { inputPerMillion: 0.25, outputPerMillion: 2 } };

function experiments(parserVersion: 1 | 2) {
  const reader = new Extractor()
    .loadDocumentLoader(new DocumentLoaderData())
    .loadStrategy(llm({ model: mockReaderWithDecimalPointShift() }));
  return {
    parser: fromDocture(parserExtractor(parserVersion), LabReport, { id: "parser" }),
    llm: fromDocture(reader, LabReport, { id: "llm", pricing: PRICING, modelId: "mock-reader" }),
  };
}

export function flagAudit(result: EvalResult): string {
  const lines = result.cases.flatMap((row) =>
    row.outcome !== "scored"
      ? []
      : row.score.fields
          .filter((item) => item.pattern === "results[].flag" && item.status !== "match")
          .map((item) => `${row.experiment} ${row.caseId} ${item.path}: expected ${String(item.expected)}, got ${String(item.actual)}`),
  );
  return lines.length === 0 ? "No flag disagrees with the truth.\n" : `${lines.join("\n")}\n`;
}

function flagAuditReporter(out: string): Reporter {
  return defineReporter({ id: "flag-audit", onResult: (result) => writeFile(join(out, "flag-audit.txt"), flagAudit(result)) });
}

const GATE = {
  thresholds: [
    { metric: "f1", min: 0.9 },
    { metric: "f1", slice: { lab: "south" }, min: 0.95 },
  ],
  regressions: { maxDrop: { f1: 0.02 } },
};

export async function evaluateLabReports(out: string): Promise<{ readonly baseline: EvalResult; readonly candidate: EvalResult }> {
  const store = memoryRunStore();
  const dataset = manifestDataset(LAB_REPORTS);
  const slices = { lab: "tags.lab" };
  const baseline = await runEval({ dataset, spec: labReportSpec, experiments: experiments(1), store, slices });
  const candidate = await runEval({
    dataset,
    spec: labReportSpec,
    experiments: experiments(2),
    store,
    slices,
    baseline: baseline.run.id,
    gate: GATE,
    reporters: [
      markdownReporter({ out: join(out, "report.md") }),
      junitReporter({ out: join(out, "junit.xml") }),
      jsonReporter({ out: join(out, "result"), layout: "split" }),
      flagAuditReporter(out),
    ],
  });
  return { baseline, candidate };
}

const f1 = (result: EvalResult, experiment: string): string => (result.summary[experiment]?.overall["f1"] ?? 0).toFixed(3);

async function main(): Promise<void> {
  heading("Evaluate a schema, on your own dataset");

  step("1. the spec");
  field("fields", labReportSpec.info.fields.map((item) => `${item.pattern}: ${item.comparator}`).join(", "));
  field("arrays", labReportSpec.info.arrays.map((item) => `${item.pattern}: ${item.rule}`).join(", "));

  step("2. the dataset, read by its own adapter");
  const cases = await manifestDataset(LAB_REPORTS).cases();
  field("cases", cases.map((item) => `${item.id} (${String(item.tags?.["lab"])})`).join(", "));
  field(
    "truth valid",
    cases.every((item) => labReportSpec.validate(item.expected).ok),
  );

  const out = await mkdtemp(join(tmpdir(), "docture-evaluate-a-schema-"));
  const { baseline, candidate } = await evaluateLabReports(out);

  step("3. the baseline run");
  field("parser F1", f1(baseline, "parser"));
  field("llm F1", f1(baseline, "llm"));
  console.log(`\n${flagAudit(baseline)}`);

  step("4. the candidate run, compared with the baseline");
  field("parser F1", f1(candidate, "parser"));
  field("llm F1", f1(candidate, "llm"));
  for (const [experiment, comparison] of Object.entries(candidate.comparison?.experiments ?? {})) {
    const delta = comparison.metrics.find((metric) => metric.metric === "f1");
    field(
      `${experiment} F1 change`,
      delta === undefined ? "n/a" : `${delta.summaryDelta === null ? "n/a" : delta.summaryDelta.toFixed(4)} (${delta.verdict})`,
    );
  }
  note(
    "Four cases is a small sample, so the paired test may not call a change significant.\n" +
      "The summary delta still shows what moved, and the gate's regression budget uses it.",
  );

  step("5. reporters, all from the one result");
  field("written to", out);
  field("files", "report.md, junit.xml, result/result.json, result/cases.jsonl, flag-audit.txt");
  const { comparison: _comparisonAlreadyShown, ...scoreboard } = candidate;
  console.log(`\n${renderScoreboard(scoreboard)}`);

  step("6. the gate");
  field("passes", candidate.gate?.pass);
  for (const check of candidate.gate?.checks.filter((item) => item.status === "fail") ?? []) field("failed", check.message);
  note(
    "The parser fix passes every check. The mocked model misreads one decimal on each\n" +
      "Southgate report, so the south slice blocks it: a CI job running `docture eval run`\n" +
      "with this gate would exit 1 here.",
  );
}

if (isMain(import.meta.url)) await run(main);
