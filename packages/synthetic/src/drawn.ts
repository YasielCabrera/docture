import type { TemplateProblem } from "./errors.js";

/** Compare what a renderer drew against the printed leaves of the mask: every drawn path must be declared, every declared leaf drawn. */
export function checkDrawn(leaves: ReadonlyMap<string, unknown>, labels: readonly { readonly path: string }[]): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  for (const { path } of labels) {
    if (!leaves.has(path)) problems.push({ code: "undeclared-field", path, message: "is drawn, but the printed mask does not declare it or its value is absent" });
  }
  const drawn = new Set(labels.map((label) => label.path));
  for (const path of leaves.keys()) {
    if (!drawn.has(path)) problems.push({ code: "unprinted-field", path, message: "is declared printed, but the template never draws it" });
  }
  return problems;
}
