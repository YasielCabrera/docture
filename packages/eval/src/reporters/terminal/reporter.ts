import { prfOf } from "../../metrics/builtin.js";
import type { Progress, Reporter } from "../../reporter.js";
import type { CaseResult, RunInfo } from "../../result/types.js";
import { defaultColumns, type Column } from "../shared/columns.js";
import { formatPercent } from "../shared/format.js";
import { renderScoreboard, type ScoreboardOptions } from "./scoreboard.js";
import { caseLine, escapeTerminal, formatDuration } from "./text.js";

/** Where the terminal reporter writes. `process.stdout` fits; so does any object with `write`. */
export interface TerminalStream {
  write(chunk: string): unknown;
  readonly isTTY?: boolean;
  readonly columns?: number;
}

export interface TerminalReporterOptions extends Omit<ScoreboardOptions, "width"> {
  /** Default `process.stdout`. */
  readonly stream?: TerminalStream;
  readonly columns?: readonly Column[];
  /** Repaint a progress panel in place. Default: whether the stream is a TTY. */
  readonly live?: boolean;
  /** Clock for the ETA. Default `Date.now`. */
  readonly now?: () => number;
}

const ETA_WINDOW = 10;
const BAR = 20;

/** Panel lines: progress with an ETA from the last ten completions, then the running F1 and error count. */
export function progressPanel(progress: Progress, rows: readonly CaseResult[], completions: readonly number[], width: number): readonly string[] {
  const share = progress.total === 0 ? 1 : progress.completed / progress.total;
  const filled = Math.round(Math.min(1, share) * BAR);
  const window = completions.slice(-ETA_WINDOW);
  const perCase = window.length < 2 ? null : (window[window.length - 1]! - window[0]!) / (window.length - 1);
  const eta = perCase === null ? null : Math.max(0, progress.total - progress.completed) * perCase;
  const lines = [
    `[${"#".repeat(filled)}${"-".repeat(BAR - filled)}] ${progress.completed}/${progress.total} ${formatPercent(share)}  ETA ${formatDuration(eta)}`,
    `F1 ${formatPercent(prfOf(rows, "run").f1)}  errored ${progress.errored}  skipped ${progress.skipped}  elapsed ${formatDuration(progress.elapsedMs)}`,
  ];
  return lines.map((line) => (line.length > width ? line.slice(0, width) : line));
}

/**
 * Print progress and the final scoreboard. On a TTY a two-line panel is repainted below the case lines;
 * otherwise each case prints one line. Narrow terminals drop low-priority columns, never the error text.
 */
export function terminalReporter(options: TerminalReporterOptions = {}): Reporter {
  const stream = options.stream ?? process.stdout;
  const live = options.live ?? stream.isTTY === true;
  const columns = options.columns ?? defaultColumns();
  const now = options.now ?? Date.now;
  const width = (): number => Math.max(40, (stream.columns ?? 100) - 1);
  let rows: CaseResult[] = [];
  let completions: number[] = [];
  let painted = 0;

  const erase = (): string => (painted === 0 ? "" : `\u001b[${painted}A\r\u001b[J`);

  return {
    id: "terminal",
    onRunStart(run: RunInfo) {
      rows = [];
      completions = [];
      painted = 0;
      const total = run.dataset.size * run.experiments.length * run.epochs;
      const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
      stream.write(`Run ${escapeTerminal(run.id)}: ${plural(run.dataset.size, "case")} × ${plural(run.experiments.length, "experiment")} × ${plural(run.epochs, "epoch")} = ${total}\n`);
    },
    onCase(row, progress) {
      rows.push(row);
      completions.push(now());
      const line = `${caseLine(row, columns, width())}\n`;
      if (!live) {
        stream.write(line);
        return;
      }
      const panel = progressPanel(progress, rows, completions, width());
      stream.write(`${erase()}${line}${panel.map((text) => `${text}\n`).join("")}`);
      painted = panel.length;
    },
    onResult(result) {
      const clear = erase();
      painted = 0;
      stream.write(`${clear}${renderScoreboard(result, { ...options, columns, width: width() })}`);
    },
  };
}
