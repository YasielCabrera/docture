import type { ConversionCase } from "./case.js";
import { corpusDocument, letter, line } from "./layout.js";

export const allTextTables: ConversionCase = {
  id: "all-text-tables",
  description: "A text-only `Name`/`Status` table ends page 1 and an unrelated text-only grid starts page 2. Matching columns without a repeated header are not evidence of one table.",
  loaded: corpusDocument(
    letter(
      line(640, ["Name", 40], ["Status", 200]),
      line(660, ["Alice", 40], ["Active", 200]),
      line(680, ["Bob", 40], ["Inactive", 200]),
    ),
    letter(
      line(100, ["Other", 40], ["Section", 200]),
      line(120, ["New", 40], ["Topic", 200]),
      line(140, ["Third", 40], ["Subject", 200]),
    ),
  ),
  checks: [
    { id: "all-text-tables/first-table-ends", kind: "table", header: ["Name", "Status"], cell: "Bob", down: null },
    { id: "all-text-tables/second-grid-stays", kind: "present", text: "Other", page: 2, sourcePages: [2] },
  ],
};
