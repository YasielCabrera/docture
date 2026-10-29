import { writeFileAtomic } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { renderJson, renderJsonSplit } from "./render.js";

export interface JsonReporterOptions {
  /** A file for `single`, a directory for `split`. */
  readonly out: string;
  /** `single` writes the whole result to one file. `split` writes `result.json` and `cases.jsonl`, the layout `readEvalResult` reads. Default `single`. */
  readonly layout?: "single" | "split";
}

/** Write the result as JSON. */
export function jsonReporter(options: JsonReporterOptions): Reporter {
  return defineReporter({
    id: "json",
    async onResult(result) {
      if (options.layout !== "split") return writeFileAtomic(options.out, renderJson(result));
      const files = renderJsonSplit(result);
      const dir = options.out.replace(/[\\/]+$/, "");
      await writeFileAtomic(`${dir}/cases.jsonl`, files.cases);
      await writeFileAtomic(`${dir}/result.json`, files.result);
    },
  });
}
