import { writeFileAtomic } from "../../node/artifacts.js";
import { defineReporter, type Reporter } from "../../reporter.js";
import { renderTemplate, type TemplateRender } from "./render.js";

export interface TemplateReporterOptions {
  readonly out: string;
  readonly render: TemplateRender;
  /** Reporter id. Default `template`. */
  readonly id?: string;
}

/** Write whatever a render function returns, such as a Slack summary or a custom text file. */
export function templateReporter(options: TemplateReporterOptions): Reporter {
  return defineReporter({ id: options.id ?? "template", onResult: (result) => writeFileAtomic(options.out, renderTemplate(result, options.render)) });
}
