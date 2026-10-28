import type { ConversionCase } from "./case.js";
import { corpusDocument, letter, line } from "./layout.js";

export const contentsLine: ConversionCase = {
  id: "contents-line",
  description: "A contents entry with a dot leader ends page 1 and a lowercase paragraph starts page 2. They are unrelated, so each stays on its own page.",
  loaded: corpusDocument(
    letter(line(690, ["Contents .......... 7", 40])),
    letter(line(100, ["the next section begins with a fresh paragraph.", 40])),
  ),
  checks: [
    { id: "contents-line/entry-stays-on-page-1", kind: "present", text: "Contents .......... 7", page: 1, sourcePages: [1] },
    { id: "contents-line/paragraph-stays-on-page-2", kind: "present", text: "the next section begins with a fresh paragraph.", page: 2, sourcePages: [2] },
    { id: "contents-line/no-false-join", kind: "absent", text: "7 the next section" },
    { id: "contents-line/reading-order", kind: "order", before: "Contents", after: "the next section begins" },
  ],
};
