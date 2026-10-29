import { execFile } from "node:child_process";
import { cp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { EVAL } from "../src/cli/specs.js";
import { captureIo, run } from "../src/index.js";
import { cleanup, cli, tempDir, writeFixture } from "./harness.js";

afterAll(cleanup);

type Hook = (caseId: string, experiment: string) => void;
const hooks = globalThis as { __doctureEvalTest?: Hook };
afterEach(() => { delete hooks.__doctureEvalTest; });

const TRUTH = { a: { invoiceNumber: "INV-1", total: 10 }, b: { invoiceNumber: "INV-2", total: 20 } };

/**
 * A two-case folder dataset and two processors that read each case's `doc.json`. `exact` answers every case
 * correctly; `off` adds `shift` to the total of case b. No model runs.
 */
function evalConfig(options: { gate?: string; extra?: string; shift?: number } = {}): string {
  return `import { fileURLToPath } from "node:url";
import { defineEval, exact } from "@docture/eval";
import { defineEvalConfig } from "@docture/eval/config";
import { folderDataset } from "@docture/eval/node";

const schema = { type: "object", properties: { invoiceNumber: { type: "string" }, total: { type: "number" } }, required: ["invoiceNumber", "total"], additionalProperties: false };
const reader = (id, shift) => ({
  id,
  config: { shift },
  async extract(item, ctx) {
    globalThis.__doctureEvalTest?.(item.id, id);
    ctx.signal.throwIfAborted();
    const data = JSON.parse(new TextDecoder().decode(await item.documents[0].bytes()));
    return { raw: { ...data, total: data.total + (item.id === "b" ? shift : 0) }, usage: { costUsd: 0.01 } };
  },
});

export default defineEvalConfig({
  dataset: folderDataset(fileURLToPath(new URL("./dataset/", import.meta.url)), { id: "invoices", documents: "doc.json", expected: "expected.json", drafts: "skip" }),
  spec: defineEval(schema, { strings: exact() }),
  experiments: { exact: reader("exact", 0), off: reader("off", ${options.shift ?? 5}) },
  concurrency: 1,
  ${options.gate === undefined ? "" : `gate: ${options.gate},`}
  ${options.extra ?? ""}
});
`;
}

async function workspace(options: Parameters<typeof evalConfig>[0] = {}): Promise<string> {
  const cwd = await tempDir("eval-config");
  await writeFixture(cwd, "docture.eval.mjs", evalConfig(options));
  for (const [id, truth] of Object.entries(TRUTH)) {
    await writeFixture(cwd, `dataset/${id}/doc.json`, JSON.stringify(truth));
    await writeFixture(cwd, `dataset/${id}/expected.json`, JSON.stringify(truth));
  }
  return cwd;
}

const runIdOf = (stderr: string): string => /→ run (\S+) /.exec(stderr)?.[1] ?? "";
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

describe("docture eval run with docture.eval.ts", () => {
  it("runs every experiment over the dataset, stores the run and says no gate ran", async () => {
    const cwd = await workspace();
    const result = await cli(["eval", "run", "--format", "json"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    const evaluated = JSON.parse(result.stdout);
    expect(evaluated.run).toMatchObject({ status: "complete", dataset: { id: "invoices", size: 2 }, experiments: [{ id: "exact" }, { id: "off" }] });
    expect(evaluated.cases.map((row: { caseId: string; experiment: string }) => `${row.caseId}/${row.experiment}`)).toEqual(["a/exact", "a/off", "b/exact", "b/off"]);
    expect(evaluated.summary.exact.overall.f1).toBe(1);
    expect(evaluated.summary.off.overall.f1).toBe(0.75);
    expect(result.stderr).toContain("No gate configured; no gate ran.");
    expect(await exists(join(cwd, ".docture/eval/runs", evaluated.run.id, "result.json"))).toBe(true);
  });

  it("prints the scoreboard and progress in text format", async () => {
    const cwd = await workspace();
    const result = await cli(["eval"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("dataset invoices: 2 cases, 1 epoch");
    expect(result.stdout).toContain("total: mismatch, expected 20, got 25");
    expect(result.stderr).toContain(": 2 cases × 2 experiments × 1 epoch = 4");
  });

  it("exits 1 when the gate fails and 0 with --no-gate", async () => {
    const cwd = await workspace({ gate: '{ thresholds: [{ metric: "f1", min: 0.9 }] }' });
    const failed = await cli(["eval", "run"], { cwd });
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("✗ Gate failed: 1 of 2 checks.\n  f1 for experiment off is 0.75, below the minimum 0.9\n");
    const skipped = await cli(["eval", "run", "--no-gate"], { cwd });
    expect(skipped.code).toBe(0);
    const passing = await cli(["eval", "run", "--experiment", "exact"], { cwd });
    expect(passing.code).toBe(0);
    expect(passing.stderr).toContain("✓ Gate passed: 1 check.");
  });

  it("selects experiments, cases and a sample, and rejects unknown experiments", async () => {
    const cwd = await workspace();
    const chosen = await cli(["eval", "run", "--experiment", "off", "--cases", "b", "--format", "json"], { cwd });
    expect(chosen.code, chosen.stderr).toBe(0);
    expect(JSON.parse(chosen.stdout).cases.map((row: { caseId: string; experiment: string }) => `${row.caseId}/${row.experiment}`)).toEqual(["b/off"]);
    const sampled = await cli(["eval", "run", "--sample", "1", "--strata", "id", "--format", "json"], { cwd });
    expect(JSON.parse(sampled.stdout).run.dataset.size).toBe(1);
    const unknown = await cli(["eval", "run", "--experiment", "llm"], { cwd });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Unknown experiment llm.");
    expect(unknown.stderr).toContain("The config defines: exact, off.");
  });

  it("writes built-in reporters into --out, replacing the config's reporters", async () => {
    const cwd = await workspace();
    const result = await cli(["eval", "run", "--reporter", "html,junit", "--reporter", "md,json,csv,terminal", "--out", "reports"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect((await readdir(join(cwd, "reports"))).sort()).toEqual(["cases.csv", "junit.xml", "report.html", "report.md", "result.json"]);
    expect(await readFile(join(cwd, "reports/junit.xml"), "utf8")).toContain('tests="4"');
    expect(await readFile(join(cwd, "reports/report.md"), "utf8")).toContain(`# Eval run ${runIdOf(result.stderr)}`);
  });

  it("loads a module reporter object and a module render function", async () => {
    const cwd = await workspace();
    await writeFixture(cwd, "summary.mjs", 'export const fileName = "summary.md";\nexport default (result) => `cases: ${result.cases.length}\\n`;\n');
    await writeFixture(cwd, "plain.mjs", "export default (result) => result.run.status;\n");
    await writeFixture(cwd, "tally.mjs", `import { writeFileSync } from "node:fs";
export const reporter = { id: "tally", onCase() {}, onResult(result) { writeFileSync(${JSON.stringify(join(cwd, "tally.txt"))}, String(result.summary.exact.overall.f1)); } };
export const unused = 1;
`);
    const result = await cli(["eval", "run", "--reporter", "./summary.mjs,./plain.mjs,./tally.mjs", "--out", "out"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect(await readFile(join(cwd, "out/summary.md"), "utf8")).toBe("cases: 4\n");
    expect(await readFile(join(cwd, "out/plain.txt"), "utf8")).toBe("complete");
    expect(await readFile(join(cwd, "tally.txt"), "utf8")).toBe("1");
    const unknown = await cli(["eval", "run", "--reporter", "pdf"], { cwd });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Unknown reporter pdf.");
  });

  it("resumes an interrupted run without extracting the finished cases again", async () => {
    const cwd = await workspace();
    const controller = new AbortController();
    const calls: string[] = [];
    hooks.__doctureEvalTest = (caseId, experiment) => {
      calls.push(`${caseId}/${experiment}`);
      if (caseId === "b") controller.abort();
    };
    const io = captureIo({ cwd, env: {}, color: false });
    expect(await run(["eval", "run", "--format", "json"], { io, signal: controller.signal })).toBe(1);
    expect(JSON.parse(io.stdout).run.status).toBe("aborted");
    expect(calls).toEqual(["a/exact", "a/off", "b/exact"]);

    calls.length = 0;
    hooks.__doctureEvalTest = (caseId, experiment) => { calls.push(`${caseId}/${experiment}`); };
    const resumed = await cli(["eval", "run", "--resume", "latest", "--format", "json"], { cwd });
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(calls).toEqual(["b/exact", "b/off"]);
    expect(JSON.parse(resumed.stdout)).toMatchObject({ run: { id: JSON.parse(io.stdout).run.id, status: "complete" } });
  });

  it("compares against a baseline run by id or automatically", async () => {
    const cwd = await workspace();
    const first = await cli(["eval", "run", "--format", "json"], { cwd });
    const baseId = JSON.parse(first.stdout).run.id;
    const auto = await cli(["eval", "run", "--baseline", "auto", "--format", "json"], { cwd });
    expect(JSON.parse(auto.stdout).comparison).toMatchObject({ baselineRunId: baseId, experiments: { exact: {}, off: {} } });
    const explicit = await cli(["eval", "run", "--baseline", baseId, "--format", "json"], { cwd });
    expect(JSON.parse(explicit.stdout).comparison.baselineRunId).toBe(baseId);
    const none = await cli(["eval", "run", "--baseline", "none", "--format", "json"], { cwd });
    expect(JSON.parse(none.stdout).comparison).toBeUndefined();
  });

  it("saves the run, then exits 1 and names each failed reporter on stderr even under --quiet", async () => {
    const cwd = await workspace();
    await writeFixture(cwd, "broken.mjs", 'export default { id: "broken", onResult() { throw new Error("disk full"); } };\n');
    const result = await cli(["eval", "run", "--reporter", "./broken.mjs,json", "--out", "out", "--quiet", "--format", "json"], { cwd });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("✗ Reporter broken failed: disk full\n");
    const evaluated = JSON.parse(result.stdout);
    expect(evaluated.warnings).toEqual(["Reporter broken: disk full"]);
    expect(JSON.parse(await readFile(join(cwd, ".docture/eval/runs", evaluated.run.id, "result.json"), "utf8")).warnings).toEqual(["Reporter broken: disk full"]);
    expect(await exists(join(cwd, "out/result.json"))).toBe(true);
  });

  it("applies the config's sections to the run", async () => {
    const cwd = await workspace({ extra: 'sections: [(await import("@docture/eval/calibration")).calibrationSection({ minSupport: 1 })],' });
    const result = await cli(["eval", "run", "--format", "json"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    expect(Object.keys(JSON.parse(result.stdout).calibration.experiments)).toEqual(["exact", "off"]);
  });

  it("finds an automatic baseline on the config's fallback branch", async () => {
    const git = (cwd: string, ...args: string[]) => promisify(execFile)("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd });
    const cwd = await workspace({ extra: 'fallbackBranch: "trunk",' });
    await git(cwd, "init", "-q", "-b", "trunk");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-q", "-m", "dataset");
    const base = JSON.parse((await cli(["eval", "run", "--format", "json"], { cwd })).stdout).run;
    expect(base.git.branch).toBe("trunk");
    await git(cwd, "checkout", "-q", "-b", "topic");
    const topic = await cli(["eval", "run", "--baseline", "auto", "--format", "json"], { cwd });
    expect(topic.code, topic.stderr).toBe(0);
    expect(JSON.parse(topic.stdout)).toMatchObject({ run: { git: { branch: "topic" } }, comparison: { baselineRunId: base.id } });
    const gated = await cli(["eval", "gate", JSON.parse(topic.stdout).run.id, "--baseline", "auto", "--format", "json"], { cwd });
    expect(gated.code, gated.stderr).toBe(0);
  });

  it("asks for a config when none exists and no files are given", async () => {
    const cwd = await tempDir("eval-no-config");
    const result = await cli(["eval", "run"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`No docture.eval.ts in ${cwd} or any parent directory.`);
  });

  it("lists every problem of an invalid config at once", async () => {
    const cwd = await tempDir("eval-bad-config");
    await writeFixture(cwd, "docture.eval.mjs", "export default { dataset: {}, experiments: {}, epochs: 0 };\n");
    const result = await cli(["eval", "run"], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "is invalid:\n  - dataset must have a string id and a cases() method\n  - spec must be an eval spec from defineEval or looseEval\n" +
      "  - experiments must name at least one processor\n  - epochs must be a positive integer\n",
    );
  });
});

describe("docture eval subcommands on stored runs", () => {
  async function twoRuns(options: Parameters<typeof evalConfig>[0] = {}): Promise<{ cwd: string; base: string; candidate: string }> {
    const cwd = await workspace(options);
    const base = JSON.parse((await cli(["eval", "run", "--format", "json", "--no-gate"], { cwd })).stdout).run.id;
    // A second file, because a module is imported once per process.
    await writeFixture(cwd, "fixed.eval.mjs", evalConfig({ ...options, shift: 0 }));
    const candidate = JSON.parse((await cli(["eval", "run", "--config", "fixed.eval.mjs", "--format", "json", "--no-gate"], { cwd })).stdout).run.id;
    return { cwd, base, candidate };
  }

  it("re-renders a stored run from its id, latest or its directory", async () => {
    const { cwd, candidate } = await twoRuns();
    const byId = await cli(["eval", "report", candidate, "--format", "json"], { cwd });
    const latest = await cli(["eval", "report", "latest", "--format", "json"], { cwd });
    const byDir = await cli(["eval", "report", `.docture/eval/runs/${candidate}`, "--format", "json", "--reporter", "md", "--out", "again"], { cwd });
    expect(byId.code, byId.stderr).toBe(0);
    expect(JSON.parse(latest.stdout)).toEqual(JSON.parse(byId.stdout));
    expect(JSON.parse(byDir.stdout)).toEqual(JSON.parse(byId.stdout));
    expect(await readFile(join(cwd, "again/report.md"), "utf8")).toContain(`# Eval run ${candidate}`);
    const text = await cli(["eval", "report", candidate], { cwd });
    expect(text.stdout).toContain(`Run ${candidate} (complete)`);
  });

  it("re-scores a stored run with the current spec as a new run", async () => {
    const { cwd, base } = await twoRuns();
    const result = await cli(["eval", "report", base, "--rescore", "--format", "json"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    const rescored = JSON.parse(result.stdout);
    expect(rescored.run.rescoredFrom).toBe(base);
    expect(rescored.run.id).not.toBe(base);
    expect(rescored.summary.off.overall.f1).toBe(0.75);
  });

  it("re-scores a run directory copied out of its store into the configured store", async () => {
    const { cwd, base } = await twoRuns();
    await cp(join(cwd, ".docture/eval/runs", base), join(cwd, "exported"), { recursive: true });
    await rm(join(cwd, ".docture"), { recursive: true, force: true });
    const result = await cli(["eval", "report", "exported", "--rescore", "--store", "rescored", "--format", "json"], { cwd });
    expect(result.code, result.stderr).toBe(0);
    const rescored = JSON.parse(result.stdout);
    expect(rescored.run.rescoredFrom).toBe(base);
    expect(rescored.summary.off.overall.f1).toBe(0.75);
    expect(JSON.parse(await readFile(join(cwd, "rescored/runs", rescored.run.id, "result.json"), "utf8")).run.rescoredFrom).toBe(base);
  });

  it("compares two runs as Markdown or JSON", async () => {
    const { cwd, base, candidate } = await twoRuns();
    const json = await cli(["eval", "compare", base, candidate, "--format", "json", "--test", "mcnemar"], { cwd });
    expect(json.code, json.stderr).toBe(0);
    const comparison = JSON.parse(json.stdout);
    expect(comparison).toMatchObject({ baselineRunId: base, candidateRunId: candidate, settings: { test: "mcnemar" } });
    expect(Object.keys(comparison.experiments)).toEqual(["exact", "off"]);
    const md = await cli(["eval", "compare", base, candidate, "--experiment", "off"], { cwd });
    expect(md.stdout).toContain(`# Comparison of run ${base} to run ${candidate}`);
    expect(md.stdout).toContain("off");
    const invalid = await cli(["eval", "compare", base, candidate, "--experiment", "exact:"], { cwd });
    expect(invalid.code).toBe(2);
  });

  it("applies the config's gate to a stored run and exits 1 when it fails", async () => {
    const { cwd, base, candidate } = await twoRuns({ gate: '{ thresholds: [{ metric: "f1", min: 0.9 }], regressions: { maxDrop: { f1: 0 } } }' });
    const failed = await cli(["eval", "gate", base, "--format", "json"], { cwd });
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({ pass: false });
    const passed = await cli(["eval", "gate", candidate, "--baseline", base], { cwd });
    expect(passed.code, passed.stderr).toBe(0);
    expect(passed.stdout).toContain("Gate");
    const regressed = await cli(["eval", "gate", base, "--baseline", candidate, "--format", "json"], { cwd });
    expect(regressed.code).toBe(1);
    expect(JSON.parse(regressed.stdout).checks.filter((check: { kind: string; status: string }) => check.kind === "regression" && check.status === "fail")).toHaveLength(1);
  });

  it("says no gate ran when the config has none", async () => {
    const { cwd, candidate } = await twoRuns();
    const result = await cli(["eval", "gate", candidate], { cwd });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("No gate configured; no gate ran.");
  });

  it("lists stored runs newest first", async () => {
    const { cwd, base, candidate } = await twoRuns();
    const json = await cli(["eval", "runs", "--format", "json"], { cwd });
    expect(JSON.parse(json.stdout).map((entry: { id: string }) => entry.id)).toEqual([candidate, base]);
    const text = await cli(["eval", "runs"], { cwd });
    expect(text.stdout.split("\n")[0]).toMatch(new RegExp(`^${candidate}  complete +\\S+ .*invoices \\(2\\)  exact F1 1\\.000, off F1 1\\.000$`));
    expect(text.stdout.split("\n")[1]).toMatch(/  exact F1 1\.000, off F1 0\.750$/);
  });
});

describe("docture eval dataset subcommands", () => {
  it("validates every case's truth and lists all problems in one error", async () => {
    const cwd = await workspace();
    const valid = await cli(["eval", "validate"], { cwd });
    expect(valid.code).toBe(0);
    expect(valid.stdout).toBe("2 cases of invoices satisfy the spec.\n");
    await writeFixture(cwd, "dataset/a/expected.json", '{"invoiceNumber":1,"total":10}');
    await writeFixture(cwd, "dataset/b/expected.json", '{"invoiceNumber":"INV-2","total":20,"extra":true}');
    const invalid = await cli(["eval", "validate"], { cwd });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("[GROUND_TRUTH_INVALID] Ground truth for 2 cases is invalid:");
    expect(invalid.stderr).toContain("a.invoiceNumber");
    expect(invalid.stderr).toContain("b.extra");
    expect(invalid.stderr).toContain("The expected values do not satisfy the eval spec.");
  });

  it("prints a deterministic sample of case ids", async () => {
    const cwd = await workspace();
    const first = await cli(["eval", "sample", "--size", "1", "--seed", "s"], { cwd });
    const again = await cli(["eval", "sample", "--size", "1", "--seed", "s"], { cwd });
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/^[ab]\n$/);
    expect(again.stdout).toBe(first.stdout);
    expect((await cli(["eval", "sample", "--size", "5"], { cwd })).stdout).toBe("a\nb\n");
    expect((await cli(["eval", "sample"], { cwd })).code).toBe(2);
  });

  it("previews a migration and writes it only with --write", async () => {
    const cwd = await workspace();
    await writeFixture(cwd, "cents.mjs", `export default {
  id: "cents", description: "totals in cents", targets: ["total"],
  apply: (expected) => ({ ...expected, total: expected.total >= 100 ? expected.total : expected.total * 100 }),
};
`);
    const preview = await cli(["eval", "migrate", "./cents.mjs"], { cwd });
    expect(preview.code, preview.stderr).toBe(0);
    expect(preview.stdout).toBe("a\n  total: 10 → 1000\nb\n  total: 20 → 2000\n");
    expect(preview.stderr).toContain("cents: 2 changes in 2 cases. Dry run; pass --write to apply.");
    expect(JSON.parse(await readFile(join(cwd, "dataset/a/expected.json"), "utf8")).total).toBe(10);
    const written = await cli(["eval", "migrate", "./cents.mjs", "--write"], { cwd });
    expect(written.code).toBe(0);
    expect(JSON.parse(await readFile(join(cwd, "dataset/a/expected.json"), "utf8")).total).toBe(1000);
  });

  it("drafts truth for a case without it, then signs it off", async () => {
    const cwd = await workspace();
    await writeFixture(cwd, "dataset/c/doc.json", JSON.stringify({ invoiceNumber: "INV-3", total: 30 }));
    const ambiguous = await cli(["eval", "draft"], { cwd });
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain("Pass --experiment with one of: exact, off.");
    const drafted = await cli(["eval", "draft", "--experiment", "exact"], { cwd });
    expect(drafted.code, drafted.stderr).toBe(0);
    expect(drafted.stdout).toBe("c\n");
    expect(JSON.parse(await readFile(join(cwd, "dataset/c/expected.draft.json"), "utf8"))).toEqual({ invoiceNumber: "INV-3", total: 30 });
    const signed = await cli(["eval", "sign-off", "c"], { cwd });
    expect(signed.code).toBe(0);
    expect(await exists(join(cwd, "dataset/c/expected.json"))).toBe(true);
    expect(await exists(join(cwd, "dataset/c/expected.draft.json"))).toBe(false);
  });
});

describe("docture eval help", () => {
  it("declares every flag of each eval subcommand once", () => {
    for (const spec of EVAL.subcommands ?? []) {
      const names = spec.flags.map((flag) => flag.name);
      expect(names.filter((name, index) => names.indexOf(name) !== index), spec.name).toEqual([]);
    }
  });

  it("lists the subcommands under eval and describes one subcommand", async () => {
    const overview = await cli(["eval", "--help"], { cwd: process.cwd() });
    expect(overview.code).toBe(0);
    for (const name of ["eval run", "eval report", "eval compare", "eval gate", "eval runs", "eval validate", "eval sample", "eval migrate", "eval draft", "eval sign-off"]) {
      expect(overview.stdout).toContain(name);
    }
    const one = await cli(["help", "eval", "compare"], { cwd: process.cwd() });
    expect(one.stdout).toContain("docture eval compare <base> <candidate> [options]");
    const flag = await cli(["eval", "gate", "--help"], { cwd: process.cwd() });
    expect(flag.stdout).toContain("docture eval gate <run> [options]");
  });
});
