import { describe, expect, it } from "vitest";
import { renderCsv } from "../../src/reporters/csv/index.js";
import { renderJson } from "../../src/reporters/json/index.js";
import { renderJunit } from "../../src/reporters/junit/index.js";
import { renderMarkdown } from "../../src/reporters/markdown/index.js";
import { renderScoreboard } from "../../src/reporters/terminal/index.js";
import { reporterResult, savedResult } from "./fixture.js";

const golden = (name: string): string => `../fixtures/reporters/${name}`;

describe("reporters render a saved result with no run", () => {
  it("keeps the saved fixture equal to the result buildResult produces", async () => {
    await expect(renderJson(reporterResult())).toMatchFileSnapshot(golden("result.json"));
  });

  it("renders Markdown", async () => {
    await expect(renderMarkdown(savedResult())).toMatchFileSnapshot(golden("report.md"));
  });

  it("renders case-level CSV", async () => {
    await expect(renderCsv(savedResult())).toMatchFileSnapshot(golden("cases.csv"));
  });

  it("renders field-level CSV", async () => {
    await expect(renderCsv(savedResult(), { level: "field" })).toMatchFileSnapshot(golden("fields.csv"));
  });

  it("renders JUnit XML", async () => {
    await expect(renderJunit(savedResult())).toMatchFileSnapshot(golden("junit.xml"));
  });

  it("renders the terminal scoreboard", async () => {
    await expect(renderScoreboard(savedResult(), { width: 100 })).toMatchFileSnapshot(golden("scoreboard.txt"));
  });
});
