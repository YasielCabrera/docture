import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentConverter, type ConversionResult, type DocumentElement, type TableElement } from "docture";
import { checkConversion, type ConversionCheck, type ConvertedPages } from "../src/conversion/index.js";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { makeRichDocumentPdf } from "docture/testing/fixtures";
import { continuationRows, fixtureDocument, tableAtPageBottom } from "./support/continuation.js";

const provenance = { pageNumber: 1, box: { x: 0, y: 0, width: 0, height: 0 }, sourceIds: ["fixture"] };
const table = (id: string, rows: TableElement["rows"], extra: Partial<TableElement> = {}): TableElement =>
  ({ id, kind: "table", rows, headerRows: 1, provenance: { ...provenance, sourceIds: [id] }, ...extra });
const onePage = (...elements: DocumentElement[]): ConvertedPages => ({ pages: [{ pageNumber: 1, elements }] });

const richChecks: readonly ConversionCheck[] = [
  { id: "intro", kind: "present", text: "Grounded text stays exact: <alpha> & beta.", page: 1, sourcePages: [1] },
  { id: "no-invented-text", kind: "absent", text: "Lorem ipsum" },
  { id: "left-column-first", kind: "order", before: "Left column starts here.", after: "Right column starts here." },
  { id: "accuracy-row", kind: "table", header: ["Metric", "Value"], cell: "Accuracy", right: "100", up: "Metric", down: "Pages", page: 1, sourcePage: 1 },
];

describe("conversion checks on a converted PDF", () => {
  const converter = new DocumentConverter().loadDocumentLoader(new DocumentLoaderPdfJs());
  let converted: ConversionResult;
  let markdown: string;
  beforeAll(async () => {
    const pdf = await makeRichDocumentPdf();
    converted = await converter.convert(pdf.bytes, { format: "json" });
    markdown = (await converter.convert(pdf.bytes, { format: "markdown" })).content;
  });
  afterAll(() => converter.dispose());

  it("passes one check of each family", () => {
    expect(checkConversion(converted, richChecks)).toEqual({
      pass: true,
      passed: 4,
      failed: 0,
      results: [
        { id: "intro", kind: "present", pass: true },
        { id: "no-invented-text", kind: "absent", pass: true },
        { id: "left-column-first", kind: "order", pass: true },
        { id: "accuracy-row", kind: "table", pass: true },
      ],
    });
  });

  it("reports corrupted text, order and table structure", () => {
    const corrupt = (element: DocumentElement): DocumentElement[] => {
      if (element.kind === "table") return [{ ...element, rows: [["Metric", "Value"], ["Accuracy", "2"], ["Pages", "100"]] }];
      if (element.kind !== "paragraph") return [element];
      if (element.text.startsWith("Grounded")) return [{ ...element, text: "Grounded text stays exact: alpha & beta." }];
      if (element.text === "Left column starts here.") return [];
      if (element.text === "Right column starts here.") return [element, { ...element, text: "Left column starts here." }, { ...element, text: "Lorem ipsum" }];
      return [element];
    };
    const corrupted = { pages: converted.pages.map((page) => ({ ...page, elements: page.elements.flatMap(corrupt) })) };
    expect(checkConversion(corrupted, richChecks)).toEqual({
      pass: false,
      passed: 0,
      failed: 4,
      results: [
        { id: "intro", kind: "present", pass: false, reason: '"Grounded text stays exact: <alpha> & beta." not found on page 1' },
        { id: "no-invented-text", kind: "absent", pass: false, reason: '"Lorem ipsum" found 1 time, first on page 1' },
        { id: "left-column-first", kind: "order", pass: false, reason: '"Left column starts here." appears after "Right column starts here."' },
        { id: "accuracy-row", kind: "table", pass: false, reason: 'cell "Accuracy" under header "Metric", "Value": right is "2", expected "100"' },
      ],
    });
  });

  it("checks Markdown as text and refuses page and table checks on a string", () => {
    expect(checkConversion(markdown, [
      { id: "order", kind: "order", before: "Left column starts here.", after: "Right column starts here." },
      { id: "escaped", kind: "present", text: "Grounded text stays exact: \\<alpha\\> & beta." },
      { id: "unescaped", kind: "present", text: "Grounded text stays exact: <alpha> & beta." },
      { id: "page", kind: "present", text: "Left column starts here.", page: 1 },
      { id: "table", kind: "table", cell: "Accuracy", right: "100" },
    ]).results).toEqual([
      { id: "order", kind: "order", pass: true },
      { id: "escaped", kind: "present", pass: true },
      { id: "unescaped", kind: "present", pass: false, reason: '"Grounded text stays exact: <alpha> & beta." not found' },
      { id: "page", kind: "present", pass: false, reason: "page, sourcePages and element need a converted document, not a string" },
      { id: "table", kind: "table", pass: false, reason: "table checks need a converted document, not a string" },
    ]);
  });
});

describe("conversion check text matching", () => {
  it("compares after Unicode and whitespace normalization, and ignores case only on request", () => {
    const output = "Café   total\n  due on the ﬁle";
    expect(checkConversion(output, [
      { id: "composed", kind: "present", text: "Café total due" },
      { id: "ligature", kind: "present", text: "the file" },
      { id: "case", kind: "present", text: "CAFÉ TOTAL" },
      { id: "ignore-case", kind: "present", text: "CAFÉ TOTAL", ignoreCase: true },
    ]).results).toEqual([
      { id: "composed", kind: "present", pass: true },
      { id: "ligature", kind: "present", pass: true },
      { id: "case", kind: "present", pass: false, reason: '"CAFÉ TOTAL" not found' },
      { id: "ignore-case", kind: "present", pass: true },
    ]);
  });

  it("counts repeated text and never matches across two blocks", () => {
    const output = "Total due\n\nTotal due\n \nNotes";
    expect(checkConversion(output, [
      { id: "twice", kind: "present", text: "Total due", count: 2 },
      { id: "once", kind: "present", text: "Total due", count: 1 },
      { id: "joined", kind: "absent", text: "Total due Total due" },
      { id: "first-total-before-notes", kind: "order", before: "Total due", after: "Notes" },
    ]).results).toEqual([
      { id: "twice", kind: "present", pass: true },
      { id: "once", kind: "present", pass: false, reason: '"Total due" found 2 times, expected 1' },
      { id: "joined", kind: "absent", pass: true },
      { id: "first-total-before-notes", kind: "order", pass: true },
    ]);
  });

  it("limits a check to the elements of one page or kind", () => {
    const output: ConvertedPages = {
      pages: [
        { pageNumber: 1, elements: [{ id: "f1", kind: "page-footer", text: "Page 1", runs: [], evidence: "repeated", provenance }] },
        { pageNumber: 2, elements: [{ id: "p2", kind: "paragraph", text: "Page 1 of the appendix", runs: [], provenance: { ...provenance, pageNumber: 2 } }] },
      ],
    };
    expect(checkConversion(output, [
      { id: "footer", kind: "present", text: "Page 1", element: "page-footer", page: 1 },
      { id: "body", kind: "absent", text: "Page 1", element: "paragraph" },
      { id: "count", kind: "present", text: "Page 1", count: 2 },
    ]).results).toEqual([
      { id: "footer", kind: "present", pass: true },
      { id: "body", kind: "absent", pass: false, reason: '"Page 1" found 1 time in a paragraph, first on page 2' },
      { id: "count", kind: "present", pass: true },
    ]);
  });
});

describe("conversion table checks", () => {
  it("tells similar tables apart by their header", () => {
    const output = onePage(
      table("amounts", [["Item", "Amount"], ["Alpha", "10"]]),
      table("prices", [["Item", "Price"], ["Alpha", "20"]]),
    );
    expect(checkConversion(output, [
      { id: "any", kind: "table", cell: "Alpha", right: "20" },
      { id: "amounts", kind: "table", header: ["Item", "Amount"], cell: "Alpha", right: "20" },
      { id: "neither", kind: "table", cell: "Alpha", right: "30", up: "Item" },
      { id: "missing", kind: "table", header: ["Item", "Cost"], cell: "Alpha" },
    ]).results).toEqual([
      { id: "any", kind: "table", pass: true },
      { id: "amounts", kind: "table", pass: false, reason: 'cell "Alpha" under header "Item", "Amount": right is "10", expected "20"' },
      { id: "neither", kind: "table", pass: false, reason: 'cell "Alpha" (2 matches, none fits): right is "10", expected "30"' },
      { id: "missing", kind: "table", pass: false, reason: 'cell "Alpha" under header "Item", "Cost" not found in a table' },
    ]);
  });

  it("reads neighbours through merged cells", () => {
    const output = onePage(table("grouped", [["Item", "Quarters", ""], ["", "Q1", "Q2"], ["Alpha", "10", "20"]], {
      headerRows: 2,
      spans: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }, { row: 0, col: 1, rowSpan: 1, colSpan: 2 }],
    }));
    expect(checkConversion(output, [
      { id: "group", kind: "table", cell: "Quarters", colSpan: 2, rowSpan: 1, left: "Item", right: null, up: null },
      { id: "child", kind: "table", cell: "Q2", up: "Quarters", left: "Q1", down: "20" },
      { id: "tall", kind: "table", cell: "Item", rowSpan: 2, down: "Alpha" },
      { id: "under-tall", kind: "table", cell: "Alpha", up: "Item", down: null },
      { id: "wrong-span", kind: "table", cell: "Q1", colSpan: 2, left: "Q2" },
    ]).results).toEqual([
      { id: "group", kind: "table", pass: true },
      { id: "child", kind: "table", pass: true },
      { id: "tall", kind: "table", pass: true },
      { id: "under-tall", kind: "table", pass: true },
      { id: "wrong-span", kind: "table", pass: false, reason: 'cell "Q1": left is "Item", expected "Q2"; colSpan is 1, expected 2' },
    ]);
  });

  it("tells a continued row's source page from the page that holds the table", async () => {
    const converted = await new DocumentConverter().convert(
      { loaded: fixtureDocument(tableAtPageBottom, continuationRows) },
      { format: "json" },
    );
    expect(checkConversion(converted, [
      { id: "continued-row", kind: "table", cell: "Gamma", right: "30", up: "Beta", page: 1, sourcePage: 2 },
      { id: "owner-page", kind: "table", cell: "Gamma", page: 2 },
      { id: "first-page-row", kind: "table", cell: "Alpha", sourcePage: 2 },
      { id: "cell-source", kind: "present", text: "Gamma", page: 1, sourcePages: [2] },
      { id: "not-on-page-2", kind: "present", text: "Gamma", page: 2 },
      { id: "wrong-source", kind: "present", text: "Alpha", sourcePages: [2] },
    ]).results).toEqual([
      { id: "continued-row", kind: "table", pass: true },
      { id: "owner-page", kind: "table", pass: false, reason: 'cell "Gamma": table is on page 1, expected 2' },
      { id: "first-page-row", kind: "table", pass: false, reason: 'cell "Alpha": row comes from page 1, expected 2' },
      { id: "cell-source", kind: "present", pass: true },
      { id: "not-on-page-2", kind: "present", pass: false, reason: '"Gamma" not found on page 2' },
      { id: "wrong-source", kind: "present", pass: false, reason: '"Alpha" comes from pages 1, expected pages 2' },
    ]);
  });
});

describe("conversion check validation", () => {
  it.each([
    ["repeated ids", [{ id: "a", kind: "absent", text: "x" }, { id: "a", kind: "absent", text: "y" }], 'Check ids must be unique and nonempty: "a".'],
    ["an empty id", [{ id: "", kind: "absent", text: "x" }], 'Check ids must be unique and nonempty: "".'],
    ["blank text", [{ id: "a", kind: "order", before: "x", after: " \n" }], 'Check "a" needs nonempty text.'],
    ["a fractional count", [{ id: "a", kind: "present", text: "x", count: 1.5 }], 'Check "a": count must be a nonnegative integer.'],
    ["page zero", [{ id: "a", kind: "absent", text: "x", page: 0 }], 'Check "a": page must be a positive integer.'],
    ["a zero span", [{ id: "a", kind: "table", cell: "x", colSpan: 0 }], 'Check "a": colSpan must be a positive integer.'],
  ] as const)("throws a RangeError for %s", (_case, checks, message) => {
    expect(() => checkConversion("x", checks)).toThrow(new RangeError(message));
  });
});
