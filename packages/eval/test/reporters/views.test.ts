import { expect, it } from "vitest";
import { gate } from "../../src/index.js";
import { renderJunit } from "../../src/reporters/junit/index.js";
import { renderHtml, HTML_IDS, type HtmlView } from "../../src/reporters/html/index.js";
import { renderMarkdown } from "../../src/reporters/markdown/index.js";
import { renderScoreboard } from "../../src/reporters/terminal/index.js";
import { calibrationTables, comparisonTables, groundingTables, gateTable } from "../../src/reporters/shared/views.js";
import { savedResult } from "./fixture.js";
import { parseHtml } from "./html-dom.js";

it("reports every experiment and places the tested paired delta beside its own interval", async () => {
  const result = savedResult();
  const tables = comparisonTables(result);
  expect(tables[0]?.columns).toEqual(["Metric", "Baseline", "Candidate", "Summary delta", "Paired delta", "Paired CI", "p", "Verdict"]);
  expect(tables[0]?.rows[0]).toEqual(["F1", "80.0%", "82.0%", "+2.0 pp", "-5.0 pp", "-9.0 pp to -1.0 pp", "<0.001", "REGRESSED"]);
  expect(tables.find((view) => view.title === "Path changes (llm)")?.rows[0]).toEqual(["lineItems[].amount", "F1", "100.0%", "50.0%", "-50.0 pp", "-50.0 pp", "n/a", "n/a", "insufficient support"]);
  const page = await parseHtml(renderHtml(result));
  const view: HtmlView = JSON.parse(page.text(page.byId(HTML_IDS.view)!));
  const panels = view.sections.find((section) => section.id === "comparison")?.panels;
  expect(panels).toEqual(tables.map((table) => ({ kind: "table", ...table })));
  const outputs = [renderMarkdown(result), renderScoreboard(result), JSON.stringify(panels)];
  for (const output of outputs) {
    expect(output).toContain("Comparison: run-0/llm to run-1/llm");
    expect(output).toContain("Comparison: run-0/parser to run-1/parser");
    for (const verdict of ["IMPROVED", "REGRESSED", "unchanged (identical pairs)", "inconclusive (not significant)", "insufficient support", "not tested (no paired values)", "incomparable (missing value)"]) expect(output).toContain(verdict);
  }
  expect(tables.find((view) => view.title === "Changed cases (parser)")?.rows[0]).toEqual(["c2", "1", "outcome", "errored", "scored", "fixed"]);
});

it("reports confidence coverage, auto-accept support and both target-coverage views", () => {
  const tables = calibrationTables(savedResult());
  expect(tables[0]?.rows[0]).toEqual(["overall", "20", "0.045", "0.1", "0.08", "0.91", "0.97", "60.0%", "50.0%", "0.9", "10", "25"]);
  expect(tables[0]?.notes).toEqual(["20 of 26 produced fields carried a confidence (76.9% confidence coverage). 2 omissions. Auto-accept target 95.0%, minimum support 1."]);
  expect(tables[1]?.rows).toEqual([
    ["overall", "50.0%", "100.0%", "n/a"], ["overall", "80.0%", "93.8%", "n/a"], ["overall", "90.0%", "n/a", "80.0%"], ["overall", "99.0%", "n/a", "50.0%"], ["overall", "100.0%", "80.0%", "50.0%"],
  ]);
});

it("reports grounding precision, recall and F1 per segment with predicted counts", () => {
  const tables = groundingTables(savedResult());
  expect(tables[0]?.rows[0]).toEqual(["overall", "7", "8", "7", "6", "6", "7", "1", "85.7%", "75.0%", "80.0%"]);
  expect(tables[1]?.title).toBe("Grounding by segment: llm");
  expect(tables[1]?.rows).toEqual([["header", "2", "2", "2", "2", "2", "2", "0", "100.0%", "100.0%", "100.0%"]]);
});

it("includes the kind of each gate check", () => {
  expect(gateTable(savedResult())?.columns).toEqual(["Status", "Kind", "Experiment", "Check", "Value", "Bound", "Message"]);
  expect(gateTable(savedResult())?.rows[0]?.slice(0, 3)).toEqual(["fail", "threshold", "llm"]);
});

it("labels aborted runs as incomplete in the scoreboard and Markdown overview", () => {
  const source = savedResult();
  const result = { ...source, run: { ...source.run, status: "aborted" as const } };
  expect(renderScoreboard(result)).toContain("(aborted, incomplete)");
  expect(renderMarkdown(result)).toContain("aborted (incomplete)");
});

it("renders an aborted run's failed completeness check in every gate view", async () => {
  const source = savedResult();
  const aborted = { ...source, run: { ...source.run, status: "aborted" as const } };
  const result = { ...aborted, gate: gate(aborted, {}) };
  expect(gateTable(result)?.rows[0]?.slice(0, 4)).toEqual(["fail", "run", "", "run status"]);
  for (const text of [renderScoreboard(result), renderMarkdown(result), renderJunit(result)]) {
    expect(text).toContain("run status");
    expect(text).toContain("incomplete");
  }
  const page = await parseHtml(renderHtml(result));
  const view: HtmlView = JSON.parse(page.text(page.byId(HTML_IDS.view)!));
  expect(view.sections.find((section) => section.id === "gate")?.panels.filter((panel) => panel.kind === "table")).toEqual([{ kind: "table", ...gateTable(result) }]);
});
