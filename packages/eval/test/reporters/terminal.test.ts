import { describe, expect, it } from "vitest";
import type { CaseResult, Progress } from "../../src/index.js";
import { renderScoreboard, terminalReporter } from "../../src/reporters/terminal/index.js";
import { savedResult } from "./fixture.js";

function stream(options: { readonly isTTY?: boolean; readonly columns?: number }) {
  const writes: string[] = [];
  return { writes, write: (chunk: string) => writes.push(chunk), ...options };
}

function progressAfter(rows: readonly CaseResult[], total: number): Progress {
  return {
    completed: rows.length,
    total,
    scored: rows.filter((row) => row.outcome === "scored").length,
    errored: rows.filter((row) => row.outcome === "errored").length,
    skipped: rows.filter((row) => row.outcome === "skipped").length,
    elapsedMs: rows.length * 1000,
  };
}

async function replay(reporter: ReturnType<typeof terminalReporter>, rows: readonly CaseResult[]): Promise<void> {
  const result = savedResult();
  await reporter.onRunStart?.(result.run);
  for (let index = 0; index < rows.length; index += 1) await reporter.onCase?.(rows[index]!, progressAfter(rows.slice(0, index + 1), 14));
}

describe("terminal reporter", () => {
  it("prints one labelled line per case when the stream is not a TTY", async () => {
    const out = stream({ columns: 200 });
    await replay(terminalReporter({ stream: out }), savedResult().cases.slice(0, 3));
    expect(out.writes).toEqual([
      "Run run-1: 4 cases × 2 experiments × 1 epoch = 8\n",
      "c1  llm  Epoch 0  scored  F1 100.0%  Precision 100.0%  Recall 100.0%  Problems 0  Time 840 ms  Cost $0.0120\n",
      "c2  llm  Epoch 0  scored  F1 84.6%  Precision 84.6%  Recall 84.6%  Problems 2  Time 1.5 s  Cost $0.0180\n",
      "c3  llm  Epoch 0  errored  F1 0.0%  Recall 0.0%  Time 300 ms  ExtractionFailedError: Every extraction strategy failed.\n",
    ]);
  });

  it("drops low-priority columns on a narrow terminal but keeps the whole error message", async () => {
    const out = stream({ columns: 50 });
    await replay(terminalReporter({ stream: out }), savedResult().cases.slice(2, 3));
    expect(out.writes[1]).toBe("c3  llm  errored  F1 0.0%  ExtractionFailedError: Every extraction strategy failed.\n");
  });

  it("repaints a progress panel in place on a TTY with an ETA from recent completions", async () => {
    const out = stream({ isTTY: true, columns: 120 });
    let clock = 0;
    const reporter = terminalReporter({ stream: out, now: () => (clock += 2000) });
    await replay(reporter, savedResult().cases.slice(0, 2));
    expect(out.writes[1]).toBe([
      "c1  llm  Epoch 0  scored  F1 100.0%  Precision 100.0%  Recall 100.0%  Problems 0  Time 840 ms  Cost $0.0120\n",
      "[#-------------------] 1/14 7.1%  ETA n/a\n",
      "F1 100.0%  errored 0  skipped 0  elapsed 1s\n",
    ].join(""));
    expect(out.writes[2]).toBe([
      "\u001b[2A\r\u001b[J",
      "c2  llm  Epoch 0  scored  F1 84.6%  Precision 84.6%  Recall 84.6%  Problems 2  Time 1.5 s  Cost $0.0180\n",
      "[###-----------------] 2/14 14.3%  ETA 24s\n",
      "F1 92.3%  errored 0  skipped 0  elapsed 2s\n",
    ].join(""));
    await reporter.onResult(savedResult());
    expect(out.writes[3]).toBe(`\u001b[2A\r\u001b[J${renderScoreboard(savedResult(), { width: 119 })}`);
  });
});
