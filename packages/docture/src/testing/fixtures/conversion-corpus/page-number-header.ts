import type { ConversionCase } from "./case.js";
import { corpusDocument, type CorpusLine, type CorpusPage } from "./layout.js";

const statement = (y: number, ...cells: CorpusLine["cells"]): CorpusLine => ({ y, cells, fontSize: 9, height: 9 });

function statementPage(pageNumber: number): CorpusPage {
  const header = pageNumber >= 2 && pageNumber <= 5 ? [statement(98.5, [`Page ${pageNumber} of 6`, 515, 46])] : [];
  const body = Array.from({ length: 12 }, (_unused, index) =>
    statement(200 + index * 30, [`07/${String(index + 1).padStart(2, "0")}/2019 Card purchase ${pageNumber}-${index + 1}`, 48, 220], [`$${index + 10}.00`, 500, 30]));
  return {
    width: 612,
    height: 792,
    lines: [
      ...header,
      statement(119.2, ["JOHN TEST", 47.7, 50.5], ["Account Number: 6547", 460.6, 100.5]),
      statement(145.6, ["TRANSACTIONS", 44.1, 71.5], ["(continued)", 118.2, 45]),
      ...body,
    ],
  };
}

export const pageNumberHeader: ConversionCase = {
  id: "page-number-header",
  description: "A six-page statement prints `Page N of 6` on pages 2 to 5 at 12.4% from the top, outside the 10% margin band, with a line of space below it. The repeated page number is a running header.",
  loaded: corpusDocument(...[1, 2, 3, 4, 5, 6].map(statementPage)),
  checks: [2, 3, 4, 5].map((page) => ({
    id: `page-number-header/page-${page}`,
    kind: "present" as const,
    text: `Page ${page} of 6`,
    element: "page-header" as const,
    page,
  })),
};
