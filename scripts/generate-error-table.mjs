import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootFlag = process.argv.indexOf("--root");
const root = rootFlag < 0 ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(process.argv[rootFlag + 1]);
const source = readFileSync(resolve(root, "packages/docture/src/core/pipeline/errors.ts"), "utf8");
const union = /export type DoctureErrorCode =([\s\S]*?);/.exec(source)?.[1];
if (union === undefined) throw Error("DoctureErrorCode union is missing");
const descriptions = {
  NO_ELIGIBLE_LOADER: "No registered loader accepts the input media type.",
  LOAD_FAILED: "Every eligible loader failed.",
  NO_CONVERTIBLE_CONTENT: "The loaded document contains no convertible text.",
  NO_ELIGIBLE_STRATEGY: "No strategy meets the loaded document's capabilities.",
  EXTRACTION_FAILED: "Every eligible extraction strategy failed.",
  PAGE_OUT_OF_RANGE: "The page selection is empty or includes unavailable pages.",
  MODEL_OUTPUT_FAILED: "A billed model response failed structured-output validation.",
  CONTRACT_VIOLATION: "Extracted data failed the requested contract.",
  UNSUPPORTED_SOURCE: "The source cannot be read.",
  TIMEOUT: "A library-owned stage deadline elapsed.",
  DUPLICATE_COMPONENT: "Two components use the same registered name.",
  SPLIT_FAILED: "Splitting is unavailable or failed.",
  UNCLASSIFIED_GROUP: "A split group matched none of the allowed kinds.",
  MISSING_ENGINE: "A selected integration's optional engine is not installed.",
  MISSING_COMPONENT: "Required wiring or call state is missing.",
};
const codes = [...union.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
const start = "<!-- docture-error-codes:start -->";
const end = "<!-- docture-error-codes:end -->";
const table = [
  start, "| Code | Meaning |", "| --- | --- |",
  ...codes.map((code) => {
    if (!(code in descriptions)) throw Error("Missing error description for " + code);
    return "| `" + code + "` | " + descriptions[code] + " |";
  }),
  end,
].join("\n");
const path = resolve(root, "README.md");
const input = readFileSync(path, "utf8");
const begin = input.indexOf(start);
const finish = input.indexOf(end);
const output = begin < 0
  ? input.trimEnd() + "\n\n### Error codes\n\n" + table + "\n"
  : input.slice(0, begin) + table + input.slice(finish + end.length);
if (process.argv.includes("--check")) {
  if (input !== output) throw Error("README error table is stale. Run node scripts/generate-error-table.mjs");
} else {
  writeFileSync(path, output);
}
