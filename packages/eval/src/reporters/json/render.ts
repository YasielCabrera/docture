import type { EvalResult } from "../../result/types.js";

/** The result as one JSON document, indented, ending in a newline. */
export function renderJson(result: EvalResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** The stored layout: `result.json` holds every member except `cases`; `cases.jsonl` holds one case per line. */
export function renderJsonSplit(result: EvalResult): { readonly result: string; readonly cases: string } {
  const { cases, ...metadata } = result;
  return { result: `${JSON.stringify(metadata)}\n`, cases: cases.map((row) => `${JSON.stringify(row)}\n`).join("") };
}
