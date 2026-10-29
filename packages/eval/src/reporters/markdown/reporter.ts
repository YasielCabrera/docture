import { writeFileAtomic } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { renderMarkdown, type MarkdownOptions } from "./render.js";

export interface MarkdownReporterOptions extends MarkdownOptions {
  readonly out: string;
}

/** Write the result as a Markdown report. */
export function markdownReporter(options: MarkdownReporterOptions): Reporter {
  return defineReporter({ id: "markdown", onResult: (result) => writeFileAtomic(options.out, renderMarkdown(result, options)) });
}
