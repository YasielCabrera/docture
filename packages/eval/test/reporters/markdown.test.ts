import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineColumn, escapeMarkdown, markdownReporter, md, renderMarkdown } from "../../src/reporters/markdown/index.js";
import { renderTemplate, templateReporter, type TemplateRender } from "../../src/reporters/template/index.js";
import { savedResult } from "./fixture.js";

describe("markdown sections", () => {
  it("composes chosen sections, custom sections and extra columns", () => {
    const rendition = defineColumn({ id: "rendition", header: "Rendition", value: (row) => String(row.tags["rendition"] ?? ""), priority: 2 });
    const text = renderMarkdown(savedResult(), {
      title: "Statement eval",
      columns: [md.defaultColumns[0]!, rendition],
      sections: [
        md.slices("rendition"),
        (result, h) => h.table(["Experiment", "F1"], Object.entries(result.summary).map(([id, summary]) => [id, h.percent(summary.overall["f1"])]), [false, true]),
        md.cases(),
        () => "",
      ],
    });
    expect(text).toBe(`# Statement eval

## Slice rendition: llm

| rendition | Cases | F1 | Precision | Recall | Exact cases | Errored cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digital | 2 | 92.3% | 92.3% | 92.3% | 50.0% | 0.0% |
| scan | 2 | 56.4% | 84.6% | 42.3% | 0.0% | 50.0% |

## Slice rendition: parser

| rendition | Cases | F1 | Precision | Recall | Exact cases | Errored cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| digital | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% |
| scan | 2 | 87.0% | 100.0% | 76.9% | 0.0% | 0.0% |

| Experiment | F1 |
| --- | ---: |
| llm | 76.9% |
| parser | 93.9% |

## Cases

| Case | Rendition |
| --- | --- |
| c1 | digital |
| c2 | scan |
| c3 | scan |
| =HYPERLINK("x")\\|&lt;b&gt;&amp;'c' | digital |
| c1 | digital |
| c2 | scan |
| c3 | scan |
`);
  });

  it("limits the failures section and says how many were left out", () => {
    const text = md.failures({ limit: 1 })(savedResult(), { table: () => "TABLE", view: () => "", escape: escapeMarkdown, percent: String, usd: String, ms: String, count: String, metric: String, columns: [] });
    expect(text.split("\n\n")).toEqual(["## Failures", "4 of 7 cases failed.", "TABLE", "### c2 (llm, epoch 0)", "TABLE", "- assertion sum(lineItems\\[\\].amount) = totals.net: lineItems\\[\\].amount sums to 35, not 30", "3 more failing cases not shown."]);
  });

  it("escapes Markdown and HTML syntax in cell text", () => {
    expect(escapeMarkdown("a|b <i>*x*</i> & [y]\nz")).toBe("a\\|b &lt;i&gt;\\*x\\*&lt;/i&gt; &amp; \\[y\\] z");
  });

  it("writes reports through the Markdown and template reporters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-md-"));
    try {
      await markdownReporter({ out: join(dir, "report.md"), sections: [md.gate()] }).onResult(savedResult());
      const summary: TemplateRender = (result, h) =>
        `F1 ${h.percent(result.summary["llm"]!.overall["f1"])}, ${result.cases.filter(h.isFailure).length} failing, gate ${result.gate?.pass ? "pass" : "fail"}\n`;
      await templateReporter({ out: join(dir, "summary.txt"), render: summary }).onResult(savedResult());
      expect((await readFile(join(dir, "report.md"), "utf8")).split("\n").slice(0, 3)).toEqual(["# Eval run run-1", "", "## Gate: fail"]);
      expect(await readFile(join(dir, "summary.txt"), "utf8")).toBe("F1 76.9%, 4 failing, gate fail\n");
      expect(renderTemplate(savedResult(), (_result, h) => h.views.overview(savedResult()).rows[4]!.join(" "))).toBe("F1 76.9% 93.9%");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
