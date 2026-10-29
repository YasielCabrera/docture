import { describe, expect, it } from "vitest";
import { csvCell, defineColumn, renderCsv } from "../../src/reporters/csv/index.js";
import { savedResult } from "./fixture.js";

describe("csv reporter", () => {
  it.each([
    ["=1+2", "'=1+2"],
    ["+cmd", "'+cmd"],
    ["-2", "'-2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tlead", "'\tlead"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ['=x,"y"', `"'=x,""y"""`],
    ["plain", "plain"],
  ])("quotes and defuses the text cell %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("writes numbers, booleans and missing values as plain fields", () => {
    expect([csvCell(-2.5), csvCell(true), csvCell(null)]).toEqual(["-2.5", "true", ""]);
  });

  it("uses custom columns at the case level", () => {
    const rendition = defineColumn({ id: "rendition", header: "Rendition", value: (row) => String(row.tags["rendition"] ?? "") });
    const outcome = defineColumn({ id: "outcome", header: "Outcome", value: (row) => row.outcome });
    expect(renderCsv(savedResult(), { columns: [rendition, outcome] }).split("\r\n").slice(0, 4)).toEqual([
      "Rendition,Outcome",
      "digital,scored",
      "scan,scored",
      "scan,errored",
    ]);
  });

  it("writes one line per scored leaf at the field level", () => {
    const result = savedResult();
    const leaves = result.cases.reduce((sum, row) => sum + (row.outcome === "scored" ? row.score.fields.length : 0), 0);
    const lines = renderCsv(result, { level: "field" }).split("\r\n");
    expect(lines).toHaveLength(leaves + 2);
    expect(lines.filter((line) => line.includes(",omission,"))).toEqual([
      "c3,parser,0,lineItems[1].sku,,lineItems[].sku,lineItems,omission,B-200,,identifier,0,1,true,,,,",
      "c3,parser,0,lineItems[1].description,,lineItems[].description,lineItems,omission,Washers,,text,0,1,false,,,,",
      "c3,parser,0,lineItems[1].amount,,lineItems[].amount,lineItems,omission,20,,number,0,1,false,,,,",
    ]);
  });
});
