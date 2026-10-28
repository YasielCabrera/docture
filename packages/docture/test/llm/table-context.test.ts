import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExtractor, type LoadedDocument } from "docture";
import { llm } from "docture/llm/text";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import { promptText, recordingCache, replyModel, type RecordedCall } from "./citation-fixtures.js";
import { boldRow, fixtureDocument, row, text, type FixtureLine } from "../core/continuation-fixtures.js";
import { groupHeaderRows, tableDocument } from "../core/table-span-fixtures.js";

const CONTEXT_END = "(Header repeated for context; not a data row.)";

const LineItems = z.object({
  lineItems: z.array(z.object({ item: z.string(), qty: z.number(), amount: z.number() })),
});

const invoiceTop: readonly FixtureLine[] = [
  text(100, "Invoice INV-7"),
  row(640, ["Item", 40], ["Qty", 200], ["Amount", 300]),
  row(660, ["Widget A", 40], ["1", 200], ["10.00", 300]),
  row(680, ["Widget B", 40], ["2", 200], ["20.00", 300]),
];

const invoiceRest: readonly FixtureLine[] = [
  row(100, ["Widget C", 40], ["3", 200], ["30.00", 300]),
  row(120, ["Widget D", 40], ["4", 200], ["40.00", 300]),
];

const paidNote: readonly FixtureLine[] = [text(100, "Paid in full on 2024-03-01.")];

function documentOf(call: RecordedCall | undefined): string {
  const sent = promptText(call?.prompt);
  return sent.slice(sent.indexOf("<document>\n") + "<document>\n".length, sent.lastIndexOf("\n</document>"));
}

function userPrompt(call: RecordedCall | undefined): string {
  const user = (call?.prompt as { role: string; content: { text: string }[] }[]).find((message) => message.role === "user");
  return user?.content.map((part) => part.text).join("\n") ?? "";
}

function rowReader(prompt: string): unknown {
  const rows: { item: string; qty: number; amount: number }[] = [];
  const citations: { path: string; ids: string[] }[] = [];
  let inContext = false;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("Table header continued from page ")) inContext = true;
    if (inContext) {
      if (line === CONTEXT_END) inContext = false;
      continue;
    }
    const match = /^(?:\[(p\d+-line-\d+)\] )?(Widget [A-Z]) (\d+) (\d+\.\d\d)$/u.exec(line);
    if (match === null) continue;
    if (match[1] !== undefined) citations.push({ path: `lineItems.${rows.length}.amount`, ids: [match[1]] });
    rows.push({ item: match[2] ?? "", qty: Number(match[3]), amount: Number(match[4]) });
  }
  const data = { lineItems: rows };
  return prompt.includes("[p1-line-1]") || prompt.includes("[p2-line-1]") ? { data, citations } : data;
}

async function extract(
  document: LoadedDocument,
  options: { readonly completion: "forbidden" | "paginate" | "concatenate"; readonly maxCharsPerRequest?: number; readonly citations?: boolean },
) {
  const { model, calls } = replyModel(rowReader);
  const cache = recordingCache();
  const result = await createExtractor({
    loaders: [inMemoryLoader(document)],
    strategies: [llm({ model, cache, ...options })],
  }).extract({ loaded: document }, LineItems);
  return { result, calls, keys: cache.keys };
}

const allItems = [
  { item: "Widget A", qty: 1, amount: 10 },
  { item: "Widget B", qty: 2, amount: 20 },
  { item: "Widget C", qty: 3, amount: 30 },
  { item: "Widget D", qty: 4, amount: 40 },
];

describe("table header context in multi-request extraction", () => {
  it("repeats a continuing table's header, marked as context, in the next page's request", async () => {
    const { result, calls } = await extract(fixtureDocument(invoiceTop, invoiceRest), { completion: "paginate" });

    expect(calls).toHaveLength(2);
    expect(documentOf(calls[0])).toBe("Invoice INV-7\nItem Qty Amount\nWidget A 1 10.00\nWidget B 2 20.00");
    expect(documentOf(calls[1])).toBe(
      "Table header continued from page 1:\nItem | Qty | Amount\n" + CONTEXT_END + "\n\n" +
      "Widget C 3 30.00\nWidget D 4 40.00",
    );
    expect(result.data.lineItems).toHaveLength(4);
    expect(result.data.lineItems).toEqual(allItems);
  });

  it("counts the repeated header against the concatenate budget", async () => {
    const { result, calls } = await extract(
      fixtureDocument(invoiceTop, invoiceRest, paidNote),
      { completion: "concatenate", maxCharsPerRequest: 90 },
    );

    expect(calls.map(documentOf)).toEqual([
      "Invoice INV-7\nItem Qty Amount\nWidget A 1 10.00\nWidget B 2 20.00",
      "Table header continued from page 1:\nItem | Qty | Amount\n" + CONTEXT_END + "\n\nWidget C 3 30.00\nWidget D 4 40.00",
      "Paid in full on 2024-03-01.",
    ]);
    expect(result.data.lineItems).toEqual(allItems);
  });

  it("adds no header to a request whose pages already hold the table's start", async () => {
    const { calls } = await extract(
      fixtureDocument(invoiceTop, invoiceRest),
      { completion: "concatenate", maxCharsPerRequest: 1_000 },
    );

    expect(calls.map(documentOf)).toEqual([
      "Invoice INV-7\nItem Qty Amount\nWidget A 1 10.00\nWidget B 2 20.00\n\nWidget C 3 30.00\nWidget D 4 40.00",
    ]);
  });

  it("renders the context without line ids when the request cites lines", async () => {
    const { result, calls } = await extract(fixtureDocument(invoiceTop, invoiceRest), { completion: "paginate", citations: true });

    expect(documentOf(calls[1])).toBe(
      "Table header continued from page 1:\nItem | Qty | Amount\n" + CONTEXT_END + "\n\n" +
      "[p2-line-1] Widget C 3 30.00\n[p2-line-2] Widget D 4 40.00",
    );
    expect(result.data.lineItems).toEqual(allItems);
    expect(result.citations?.filter((citation) => citation.path.endsWith(".amount"))).toEqual([
      { path: "lineItems.0.amount", ids: ["p1-line-3"], status: "verified" },
      { path: "lineItems.1.amount", ids: ["p1-line-4"], status: "verified" },
      { path: "lineItems.2.amount", ids: ["p2-line-1"], status: "verified" },
      { path: "lineItems.3.amount", ids: ["p2-line-2"], status: "verified" },
    ]);
    expect(result.citationSources?.map((source) => source.id)).toEqual(["p1-line-3", "p1-line-4", "p2-line-1", "p2-line-2"]);
  });

  it("repeats only the header of the table that continues", async () => {
    const codes: readonly FixtureLine[] = [
      row(100, ["Code", 40], ["Units", 200]),
      row(120, ["A1", 40], ["3", 200]),
      row(140, ["B2", 40], ["4", 200]),
    ];
    const { calls } = await extract(fixtureDocument([...codes, ...invoiceTop.slice(1)], invoiceRest), { completion: "paginate" });

    expect(documentOf(calls[1])).toBe(
      "Table header continued from page 1:\nItem | Qty | Amount\n" + CONTEXT_END + "\n\n" +
      "Widget C 3 30.00\nWidget D 4 40.00",
    );
  });

  it("adds no header when the next page starts a different table", async () => {
    const ownTable: readonly FixtureLine[] = [
      boldRow(100, ["Code", 40], ["Units", 200], ["Total", 300]),
      row(120, ["A1", 40], ["3", 200], ["30", 300]),
      row(140, ["B2", 40], ["4", 200], ["40", 300]),
    ];
    const { calls } = await extract(fixtureDocument(invoiceTop, ownTable), { completion: "paginate" });

    expect(documentOf(calls[1])).toBe("Code Units Total\nA1 3 30\nB2 4 40");
  });

  it("flattens a multi-row header with its column spans", async () => {
    const atBottom = groupHeaderRows.map((tableRow) => ({ ...tableRow, y: tableRow.y + 520 }));
    const rest = [
      { y: 100, cells: [["Gamma", 40], ["50", 200], ["60", 230]] as const },
      { y: 120, cells: [["Delta", 40], ["70", 200], ["80", 230]] as const },
    ];
    const { calls } = await extract(tableDocument(atBottom, rest), { completion: "paginate" });

    expect(documentOf(calls[1])).toBe(
      "Table header continued from page 1:\nItem | Quarters / Q1 | Quarters / Q2\n" + CONTEXT_END + "\n\n" +
      "Gamma 50 60\nDelta 70 80",
    );
  });

  it("keys the response cache by the prompt that carries the context", async () => {
    const positioned = fixtureDocument(invoiceTop, invoiceRest);
    const plain = loadedDocument(positioned.pages.map((page) => page.text), { geometry: false });
    const withContext = await extract(positioned, { completion: "paginate" });
    const without = await extract(plain, { completion: "paginate" });

    expect(withContext.keys).toHaveLength(2);
    expect(without.keys[0]).toBe(withContext.keys[0]);
    expect(without.keys[1]).not.toBe(withContext.keys[1]);
  });
});

describe("requests that carry no table context", () => {
  const probePages = [
    "Item | Qty | Amount\nWidget A | 1 | 10.00\nWidget B | 2 | 20.00",
    "Widget C | 3 | 30.00\nWidget D | 4 | 40.00",
  ];

  it("sends a document without lines exactly as before under paginate and concatenate", async () => {
    const document = loadedDocument(probePages, { geometry: false });
    const expected = [
      "Extract the requested fields from the document below.\n\n<document>\n" +
        "Item | Qty | Amount\nWidget A | 1 | 10.00\nWidget B | 2 | 20.00\n</document>",
      "Extract the requested fields from the document below.\n\n<document>\n" +
        "Widget C | 3 | 30.00\nWidget D | 4 | 40.00\n</document>",
    ];

    expect((await extract(document, { completion: "paginate" })).calls.map(userPrompt)).toEqual(expected);
    expect((await extract(document, { completion: "concatenate", maxCharsPerRequest: 60 })).calls.map(userPrompt)).toEqual(expected);
  });

  it("sends the whole document unchanged under forbidden", async () => {
    const { calls } = await extract(fixtureDocument(invoiceTop, invoiceRest), { completion: "forbidden" });

    expect(calls.map(userPrompt)).toEqual([
      "Extract the requested fields from the document below.\n\n<document>\n" +
        "Invoice INV-7\nItem Qty Amount\nWidget A 1 10.00\nWidget B 2 20.00\fWidget C 3 30.00\nWidget D 4 40.00\n</document>",
    ]);
  });
});
