import { HTML_IDS, type HtmlView } from "../src/reporters/html/view.js";
import type { EvalResult } from "../src/result/types.js";
import { documentsElement } from "./documents.js";
import { copy, el, mustFind, readJson } from "./dom.js";
import { sectionElement } from "./panels.js";

function runLine(result: EvalResult): string {
  const { run } = result;
  const parts = [
    `${run.id}`,
    run.status === "aborted" ? "aborted (incomplete)" : run.status,
    `${run.dataset.id}, ${run.dataset.size} cases`,
    `${run.experiments.map((experiment) => experiment.id).join(", ")}`,
    `${run.epochs} epoch${run.epochs === 1 ? "" : "s"}`,
    run.finishedAt === undefined ? run.startedAt : `${run.startedAt} to ${run.finishedAt}`,
  ];
  if (run.git !== undefined) parts.push(`${run.git.branch}@${run.git.sha}${run.git.dirty ? " (dirty)" : ""}`);
  return parts.join(" · ");
}

function main(): void {
  const result = readJson<EvalResult>(HTML_IDS.result);
  const view = readJson<HtmlView>(HTML_IDS.view);
  const app = mustFind(HTML_IDS.app);
  const nodes: HTMLElement[] = [el("p", "run", runLine(result))];
  if (view.detail === "failures") nodes.push(el("p", "note", copy("detail-failures")));
  const nav = el("nav", "toc");
  for (const section of view.sections) {
    if (section.title === "") continue;
    const link = el("a", "", section.title);
    link.href = `#section-${section.id}`;
    nav.append(link);
  }
  const cases = el("a", "", copy("cases"));
  cases.href = "#section-cases";
  nav.append(cases);
  nodes.push(nav, ...view.sections.map(sectionElement), documentsElement(result, view));
  app.replaceChildren(...nodes);
}

main();
