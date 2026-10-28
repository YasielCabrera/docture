import type { ConversionCase } from "./case.js";
import { corpusDocument, letter, line } from "./layout.js";

export const runningHeader: ConversionCase = {
  id: "running-header",
  description: "A two-page document repeats `Report 2026` at the top of each page, 2 points above the second page's rows. Two copies are not proof of furniture, so the line stays text and the page 1 table does not take it or the rows below it.",
  loaded: corpusDocument(
    letter(
      line(50, ["Report", 40], ["2026", 200]),
      line(100, ["Overview of the report.", 40]),
      line(640, ["Item", 40], ["Amount", 200]),
      line(660, ["Alpha", 40], ["10", 200]),
      line(680, ["Beta", 40], ["20", 200]),
    ),
    letter(
      line(50, ["Report", 40], ["2026", 200]),
      line(64, ["Gamma", 40], ["30", 200]),
      line(84, ["Delta", 40], ["40", 200]),
    ),
  ),
  checks: [
    { id: "running-header/table-ends-at-page-break", kind: "table", header: ["Item", "Amount"], cell: "Beta", down: null },
    { id: "running-header/header-is-not-a-row", kind: "absent", text: "Report", element: "table", page: 1 },
    { id: "running-header/second-page-rows-stay", kind: "present", text: "Gamma", page: 2, sourcePages: [2] },
  ],
};
