import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../../", import.meta.url));

describe("loader conformance reporting", () => {
  it("reports option and capability skips without hiding a legitimate scan refusal", () => {
    const directory = mkdtempSync(join(tmpdir(), "docture-conformance-"));
    try {
      const output = join(directory, "report.json");
      const filter = "reports a text document|spans a long|handles a page|produces positioned|puts the expected text|renders a page";
      const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "test/testing/fixtures/vitest.config.mjs", "-t", filter, "--reporter=json", "--outputFile=" + output], { cwd, encoding: "utf8" });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const report = JSON.parse(readFileSync(output, "utf8"));
      const rows = report.testResults.flatMap((suite: { assertionResults: { fullName: string; status: string }[] }) => suite.assertionResults);
      const state = (suite: string, test: string) => rows.find((row: { fullName: string }) => row.fullName === "loader conformance: " + suite + " " + test)?.status;
      for (const name of [
        "spans a long document across pages", "handles a page with no text without throwing",
        "produces positioned geometry inside the page box", "puts the expected text in a line, not just in the page blob",
        "renders a page to an image on demand",
      ]) expect(state("configured skips", name)).toBe("skipped");
      for (const name of [
        "reports a text document as digital", "produces positioned geometry inside the page box",
        "puts the expected text in a line, not just in the page blob", "renders a page to an image on demand",
      ]) expect(state("capability skips", name)).toBe("skipped");
      expect(state("capability skips", "handles a page with no text without throwing")).toBe("passed");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("detects broken sequential and concurrent instance reuse", () => {
    const directory = mkdtempSync(join(tmpdir(), "docture-conformance-reuse-"));
    try {
      const output = join(directory, "report.json");
      const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "test/testing/fixtures/vitest.config.mjs", "-t", "loads distinct documents", "--reporter=json", "--outputFile=" + output], { cwd, encoding: "utf8" });
      const report = JSON.parse(readFileSync(output, "utf8"));
      const rows = report.testResults.flatMap((suite: { assertionResults: { fullName: string; status: string }[] }) => suite.assertionResults);
      const state = (suite: string, kind: string) => rows.find((row: { fullName: string }) => row.fullName === "loader conformance: " + suite + " loads distinct documents " + kind + " on one instance")?.status;
      expect(state("reuse good", "sequentially")).toBe("passed");
      expect(state("reuse good", "concurrently")).toBe("passed");
      expect(state("reuse broken second", "sequentially")).toBe("failed");
      expect(state("reuse broken concurrent", "concurrently")).toBe("failed");
      expect(run.status, run.stdout + run.stderr).toBe(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
