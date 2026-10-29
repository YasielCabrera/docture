import { writeFileAtomic } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { checkThreshold, renderJunit, type JunitOptions } from "./render.js";

export interface JunitReporterOptions extends JunitOptions {
  readonly out: string;
}

/** Write the result as JUnit XML for CI test views. */
export function junitReporter(options: JunitReporterOptions): Reporter {
  checkThreshold(options.threshold);
  return defineReporter({ id: "junit", onResult: (result) => writeFileAtomic(options.out, renderJunit(result, options)) });
}
