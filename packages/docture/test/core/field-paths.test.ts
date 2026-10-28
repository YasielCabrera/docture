import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, formatFieldPath, parseFieldPath } from "docture";
import { llm } from "docture/llm/text";
import { mergePartialsWithDiagnostics } from "docture/llm/merge";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { positionedDocument, replyModel } from "../llm/citation-fixtures.js";
import { mockModel } from "../llm/mock-model.js";

describe("conflict paths for literal dotted keys", () => {
  it("reports no conflict when one part has a dotted key beside the nested field it spells", () => {
    const merged = mergePartialsWithDiagnostics([{ data: { "a.b": 1, a: { b: 2 } }, pages: [1] }]);

    expect(merged.data).toEqual({ "a.b": 1, a: { b: 2 } });
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps a literal dotted key and the nested field apart when both disagree across parts", () => {
    const merged = mergePartialsWithDiagnostics([
      { data: { "a.b": 1, a: { b: 2 } }, pages: [1] },
      { data: { "a.b": 3, a: { b: 4 } }, pages: [2] },
    ]);

    expect(merged.conflicts).toEqual([
      { path: "`a.b`", values: [{ value: 1, pages: [1] }, { value: 3, pages: [2] }] },
      { path: "a.b", values: [{ value: 2, pages: [1] }, { value: 4, pages: [2] }] },
    ]);
    expect(merged.conflicts.map((conflict) => parseFieldPath(conflict.path))).toEqual([["a.b"], ["a", "b"]]);
  });

  it("names empty keys at the top level and inside an object", () => {
    const merged = mergePartialsWithDiagnostics([
      { data: { "": "x", note: { "": "p" } }, pages: [1] },
      { data: { "": "y", note: { "": "q" } }, pages: [2] },
    ]);

    expect(merged.conflicts.map((conflict) => conflict.path)).toEqual(["``", "note.``"]);
  });

  it("reports the same quoted path from a paginated text extraction", async () => {
    const Totals = z.object({ "total.net": z.number(), total: z.object({ net: z.number() }) });
    const { model } = mockModel([{ "total.net": 10, total: { net: 10 } }, { "total.net": 12, total: { net: 10 } }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(loadedDocument(["Page one of the statement shows a net amount of 10.", "Page two of the statement shows a net amount of 12."]))],
      strategies: [llm({ model, completion: "paginate", concurrency: 1 })],
    }).extract(new Uint8Array([1]), Totals);

    expect(result.data).toEqual({ "total.net": 10, total: { net: 10 } });
    expect(result.conflicts).toEqual([
      { path: "`total.net`", values: [{ value: 10, pages: [1] }, { value: 12, pages: [2] }] },
    ]);
  });
});

describe("citation paths for literal dotted keys", () => {
  it("gives a literal dotted key and the nested field distinct citation paths", async () => {
    const document = positionedDocument([["Net amount on this statement: 1", "Gross amount on this statement: 2"]]);
    const { model } = replyModel([{
      data: { "a.b": 1, a: { b: 2 } },
      citations: [{ path: "a.b", ids: ["p1-line-2"] }],
    }]);
    const result = await createExtractor({
      loaders: [inMemoryLoader(document)],
      strategies: [llm({ model, citations: true })],
    }).extract({ loaded: document }, z.object({ "a.b": z.number(), a: z.object({ b: z.number() }) }));

    expect(result.citations?.map((citation) => [citation.path, citation.status])).toEqual([
      ["`a.b`", "uncited"],
      ["a.b", "verified"],
    ]);
  });
});

describe("field path encoding", () => {
  it("leaves plain keys and array indexes dotted", () => {
    expect(formatFieldPath(["lineItems", 3, "amount"])).toBe("lineItems.3.amount");
    expect(formatFieldPath([])).toBe("");
  });

  it("quotes keys with dots, backticks or no characters", () => {
    expect(formatFieldPath(["a.b"])).toBe("`a.b`");
    expect(formatFieldPath([""])).toBe("``");
    expect(formatFieldPath(["", ""])).toBe("``.``");
    expect(formatFieldPath(["say `hi`", "x"])).toBe("`say \\`hi\\``.x");
    expect(formatFieldPath(["back\\slash"])).toBe("back\\slash");
    expect(formatFieldPath(["a.\\"])).toBe("`a.\\\\`");
  });

  it("parses every formatted path back to its segments", () => {
    const cases: readonly (readonly string[])[] = [
      [], [""], ["", ""], ["a", "b"], ["a.b"], ["a.b", "c"], ["a", "b.c"], ["`"], ["\\"], ["a.\\"],
      ["say `hi`", "x"], ["back\\slash"], ["lineItems", "3", "amount"], [" "], ["a`b"],
    ];
    for (const segments of cases) expect(parseFieldPath(formatFieldPath(segments))).toEqual(segments);
    expect(new Set(cases.map(formatFieldPath)).size).toBe(cases.length);
  });

  it("rejects text that is not a formatted path", () => {
    for (const text of ["a..b", ".a", "a.", "`a", "a`b", "`a`b", "`a\\x`"]) expect(parseFieldPath(text)).toBeUndefined();
  });
});
