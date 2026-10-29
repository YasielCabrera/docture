import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildResult, looseEval, parseEvalResult, type CaseResult } from "../src/index.js";
import { calibrate, mergeCalibration } from "../src/calibration/index.js";
import { grounding } from "../src/grounding/index.js";
import { compareRuns } from "../src/comparison/index.js";
import { fileRunStore } from "../src/node/index.js";
import { runInfo } from "./support/run.js";

it("round-trips every statistical section through JSON and the file store before exact calibration merge", async () => {
  const spec = looseEval();
  const cases: CaseResult[] = Array.from({ length: 12 }, (_, i) => {
    const expected = { a: 1 }, actual = { a: i % 2 };
    const locations = { a: [{ pageNumber: 1 }] };
    return { caseId: String(i), epoch: 0, experiment: "x", tags: {}, locations, startedAt: "2026-01-01", ms: i, outcome: "scored", expected, actual, score: spec.score(expected, actual, { locations, evidence: [{ path: "a", pageNumber: 1 }], confidence: { a: 0.8 } }) };
  });
  const run = runInfo(["x"], 1, spec);
  const base = buildResult({ run, cases });
  const calibration = calibrate(base), ground = grounding(base), comparison = compareRuns(base, base);
  const enriched = buildResult({ run, cases, calibration, grounding: ground, comparison });
  const parsed = parseEvalResult(JSON.parse(JSON.stringify(enriched)));
  expect(parsed).toEqual(JSON.parse(JSON.stringify(enriched)));
  expect(parsed.calibration).toEqual(calibration);
  expect(parsed.grounding).toEqual(ground);
  expect(parsed.comparison).toEqual(comparison);
  const dir = await mkdtemp(join(tmpdir(), "eval-stats-"));
  try {
    const store = fileRunStore(dir);
    await store.createRun(run);
    await store.finalize(parsed);
    const stored = await store.readResult(run.id);
    expect(stored).toEqual(parsed);
    if (stored.calibration === undefined) throw new Error("calibration was lost");
    expect(mergeCalibration(stored.calibration, parsed.calibration!)).toEqual(calibrate(buildResult({ run, cases: [...cases, ...cases] })));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
