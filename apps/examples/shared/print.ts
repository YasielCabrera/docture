/**
 * Printing. None of this is the lesson either — but the OUTPUT is half of every
 * example, so it lives somewhere sharp rather than inline.
 */

import type { ExtractionResult } from "docture";

export function heading(title: string): void {
  console.log(`\n${"=".repeat(76)}\n${title}\n${"=".repeat(76)}`);
}

/** A smaller divider, for steps inside one example. */
export function step(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 72 - title.length))}`);
}

export function field(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)} ${String(value)}`);
}

export function note(text: string): void {
  console.log(`\n  ${text.split("\n").join("\n  ")}`);
}

export function amount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `[1,2,3]` becomes `"1 to 3"`; `[1,3]` stays `"1, 3"`. */
export function pageRange(pages: readonly number[]): string {
  if (pages.length === 0) return "none";
  if (pages.length === 1) return String(pages[0]);
  const contiguous = pages.every((page, i) => i === 0 || page === (pages[i - 1] ?? 0) + 1);
  return contiguous ? `${pages[0]} to ${pages.at(-1)}` : pages.join(", ");
}

export interface Column {
  readonly header: string;
  readonly width: number;
  readonly right?: boolean;
}

/** A fixed-width table. Numeric columns are right-aligned. */
export function table(columns: readonly Column[], rows: readonly (readonly unknown[])[]): void {
  const line = (cells: readonly unknown[]): string =>
    "  " +
    cells
      .map((cell, i) => {
        const column = columns[i];
        if (column === undefined) return String(cell);
        const text = String(cell ?? "");
        const clipped = text.length > column.width ? `${text.slice(0, column.width - 1)}…` : text;
        return column.right === true
          ? clipped.padStart(column.width)
          : clipped.padEnd(column.width);
      })
      .join("  ");

  console.log(line(columns.map((c) => c.header)));
  console.log("  " + columns.map((c) => "-".repeat(c.width)).join("  "));
  for (const row of rows) console.log(line(row));
}

/** How the run went: which strategy answered, what it cost, what else was tried. */
export function provenance(result: ExtractionResult<unknown>): void {
  console.log(
    `\n  answered by "${result.method}" via loader "${result.loader}" in ${result.usage.wallMs} ms`,
  );
  console.log(
    `  ${
      result.usage.totalTokens === 0
        ? "no tokens, no cost"
        : `${result.usage.totalTokens.toLocaleString()} tokens` +
          (result.usage.costUsd === undefined
            ? " (no pricing table, so cost is unknown)"
            : `, $${result.usage.costUsd.toFixed(4)}`)
    }`,
  );

  const failed = result.attempts.filter((a) => a.status === "failed");
  if (failed.length > 0) {
    console.log("  tried first and failed:");
    for (const attempt of failed) {
      console.log(`    ${attempt.strategy}: ${attempt.error ?? "unknown error"}`);
    }
  }
}
