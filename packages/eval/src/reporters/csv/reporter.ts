import { writeFileAtomic } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { renderCsv, type CsvOptions } from "./render.js";

export interface CsvReporterOptions extends CsvOptions {
  readonly out: string;
}

/** Write the result as CSV. */
export function csvReporter(options: CsvReporterOptions): Reporter {
  return defineReporter({ id: "csv", onResult: (result) => writeFileAtomic(options.out, renderCsv(result, options)) });
}
