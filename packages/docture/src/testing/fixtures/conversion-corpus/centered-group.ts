import type { ConversionCase } from "./case.js";
import { boldLine, corpusDocument, letter, line } from "./layout.js";

export const centeredGroup: ConversionCase = {
  id: "centered-group",
  description: "A bold `Quarters` label is centred above the bold `Q1` and `Q2` column headers, overlapping neither column. As part of an evidenced header, it spans both child columns.",
  loaded: corpusDocument(letter(
    boldLine(100, ["Item", 40, 20], ["Quarters", 215, 40]),
    boldLine(120, ["Q1", 200, 10], ["Q2", 260, 10]),
    line(140, ["Alpha", 40, 25], ["10", 200, 10], ["20", 260, 10]),
    line(160, ["Beta", 40, 20], ["30", 200, 10], ["40", 260, 10]),
  )),
  checks: [
    { id: "centered-group/label-spans-child-columns", kind: "table", cell: "Quarters", colSpan: 2, rowSpan: 1, left: "Item" },
    { id: "centered-group/first-child-under-label", kind: "table", cell: "Q1", up: "Quarters", down: "10" },
    { id: "centered-group/second-child-under-label", kind: "table", cell: "Q2", up: "Quarters", down: "20" },
    { id: "centered-group/body-rows-kept", kind: "table", cell: "Alpha", right: "10", down: "Beta" },
  ],
};
