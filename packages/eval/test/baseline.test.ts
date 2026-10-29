import { describe, expect, it } from "vitest";
import { EvalSpecError, compareCodeUnits, resolveBaseline, type RunIndexEntry } from "../src/index.js";

function entry(id: string, startedAt: string, options: { branch?: string; status?: RunIndexEntry["status"]; fingerprint?: string } = {}): RunIndexEntry {
  return {
    id,
    status: options.status ?? "complete",
    startedAt,
    ...(options.branch === undefined ? {} : { git: { branch: options.branch, sha: "abc", dirty: false } }),
    dataset: { id: "invoices", size: 3, fingerprint: options.fingerprint ?? "aa" },
    spec: { fingerprint: "spec" },
    experiments: [{ id: "llm", configHash: "c" }],
  };
}

const store = (entries: readonly RunIndexEntry[]) => ({ listRuns: async () => entries });

describe("resolveBaseline", () => {
  it("picks the most recently started complete run, whatever order the store lists runs in", async () => {
    const runs = [
      entry("late", "2026-10-03T00:00:00Z", { branch: "main" }),
      entry("early", "2026-10-01T00:00:00Z", { branch: "main" }),
      entry("newest-aborted", "2026-10-04T00:00:00Z", { branch: "main", status: "aborted" }),
      entry("running", "2026-10-05T00:00:00Z", { branch: "main", status: "in-progress" }),
    ];
    expect(await resolveBaseline(store(runs))).toBe("late");
    expect(await resolveBaseline(store(runs), { exclude: "late" })).toBe("early");
  });

  it("looks on the branch, then on the fallback branch", async () => {
    const runs = [entry("main-run", "2026-10-02T00:00:00Z", { branch: "main" }), entry("topic-run", "2026-10-01T00:00:00Z", { branch: "topic" })];
    expect(await resolveBaseline(store(runs), { branch: "topic", fallbackBranch: "main" })).toBe("topic-run");
    expect(await resolveBaseline(store(runs), { branch: "other", fallbackBranch: "main" })).toBe("main-run");
    expect(await resolveBaseline(store(runs), { branch: "other" })).toBe(undefined);
  });

  it("keeps only runs over the same dataset and needs its fingerprint to do so", async () => {
    const runs = [entry("new-data", "2026-10-02T00:00:00Z", { fingerprint: "bb" }), entry("same-data", "2026-10-01T00:00:00Z", { fingerprint: "aa" })];
    expect(await resolveBaseline(store(runs), { requireSameDataset: true, datasetFingerprint: "aa" })).toBe("same-data");
    await expect(resolveBaseline(store(runs), { requireSameDataset: true })).rejects.toThrow(EvalSpecError);
    await expect(resolveBaseline(store(runs), { requireSameDataset: true })).rejects.toThrow("baseline.datasetFingerprint: requireSameDataset needs the dataset fingerprint to match");
  });
});

describe("compareCodeUnits", () => {
  it("orders by UTF-16 code unit, independent of the host locale", () => {
    expect(["b", "å", "B", "a", "aa", "Z"].sort(compareCodeUnits)).toEqual(["B", "Z", "a", "aa", "b", "å"]);
    expect([compareCodeUnits("x", "x"), compareCodeUnits("a", "b"), compareCodeUnits("b", "a")]).toEqual([0, -1, 1]);
  });
});
