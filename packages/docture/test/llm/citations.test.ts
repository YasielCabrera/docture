import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonSchema } from "ai";
import { z } from "zod";
import { createExtractor, withRasterizer, type FlexibleSchema, type Rasterizer } from "docture";
import { llm } from "docture/llm/text";
import { vision } from "docture/llm/vision";
import { createLlmExtractor } from "docture/llm/extractor";
import { fileCache, memoryCache, type LlmCache } from "docture/llm/cache";
import { inMemoryLoader, loadedDocument } from "docture/testing/doubles";
import {
  invoicePages,
  positionedDocument,
  promptText,
  recordingCache,
  replyModel,
  uncitedRequests,
} from "./citation-fixtures.js";
import uncitedFixture from "./fixtures/uncited-request.json" with { type: "json" };

const CITE_LINES =
  "Each document line starts with its id in square brackets, such as [p1-line-1].\n" +
  'Put the fields in "data". In "citations", add one entry for each value you return: "path" is the ' +
  "field's dotted path, with 0-based array indexes (lineItems.0.amount), and \"ids\" lists the ids of " +
  "the lines that show the value.\n" +
  'Use only ids that appear in the document below. Leave a value out of "citations" when no line shows it.';

function box(index: number, text: string) {
  return { x: 72, y: 100 + index * 20, width: text.length * 6, height: 12 };
}

async function extractCited<T>(
  pages: readonly (readonly string[])[],
  schema: FlexibleSchema<T>,
  replies: readonly unknown[] | ((prompt: string) => unknown),
  options: { readonly completion?: "forbidden" | "paginate"; readonly cache?: LlmCache } = {},
) {
  const { model, calls } = replyModel(replies);
  const document = positionedDocument(pages);
  const result = await createExtractor({
    loaders: [inMemoryLoader(document)],
    strategies: [llm({ model, citations: true, ...options })],
  }).extract({ loaded: document }, schema);
  return { result, calls };
}

describe("field citations", () => {
  it("marks each present leaf verified, cited-unverified or uncited", async () => {
    const { result, calls } = await extractCited(
      invoicePages.slice(0, 1),
      z.object({ total: z.number(), invented: z.string(), note: z.string() }),
      [{
        data: { total: 1234.5, invented: "ACME", note: "n/a" },
        citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "invented", ids: ["p1-line-1"] }],
      }],
      { completion: "paginate" },
    );

    expect(result.data).toEqual({ total: 1234.5, invented: "ACME", note: "n/a" });
    expect(result.citations).toEqual([
      { path: "total", ids: ["p1-line-1"], status: "verified" },
      { path: "invented", ids: ["p1-line-1"], status: "cited-unverified" },
      { path: "note", ids: [], status: "uncited" },
    ]);
    expect(result.citationSources).toEqual([
      { id: "p1-line-1", pageNumber: 1, box: { x: 72, y: 100, width: 120, height: 12 }, text: "Total due: $1,234.50" },
    ]);
    expect(promptText(calls[0]?.prompt)).toContain(
      "Extract the requested fields from the document below.\n" + CITE_LINES + "\n\n<document>\n" +
      "[p1-line-1] Total due: $1,234.50\n" +
      "[p1-line-2] Invoice INV-0042 issued by ACME Corp for consulting services.\n</document>",
    );
    expect((calls[0]?.responseFormat as { schema: { required: string[] } }).schema.required).toEqual(["data", "citations"]);
  });

  it("does not take an id the request never showed as evidence", async () => {
    const { result } = await extractCited(invoicePages.slice(0, 1), z.object({ total: z.number() }), [{
      data: { total: 1234.5 }, citations: [{ path: "total", ids: ["p9-line-1"] }],
    }]);

    expect(result.citations).toEqual([{ path: "total", ids: [], status: "cited-unverified" }]);
    expect(result.citationSources).toEqual([]);
  });

  it("keeps exactly the lines a verified match spans", async () => {
    const pages = [["Bill to ACME", "Corp Springfield", "Total 7.00 payable within thirty days"]];
    const { result } = await extractCited(
      pages,
      z.object({ vendor: z.string(), total: z.number(), joined: z.string() }),
      [{
        data: { vendor: "ACME Corp", total: 7, joined: "ACME Total" },
        citations: [
          { path: "vendor", ids: ["p1-line-3", "p1-line-1", "p1-line-2"] },
          { path: "total", ids: ["p1-line-1", "p1-line-3"] },
          { path: "joined", ids: ["p1-line-1", "p1-line-3"] },
        ],
      }],
    );

    expect(result.citations).toEqual([
      { path: "vendor", ids: ["p1-line-1", "p1-line-2"], status: "verified" },
      { path: "total", ids: ["p1-line-3"], status: "verified" },
      { path: "joined", ids: ["p1-line-1", "p1-line-3"], status: "cited-unverified" },
    ]);
  });

  it("rebases array indexes and scalar winners across merged pages", async () => {
    const pages = [
      ["Item Widgets amount 10.00", "Subtotal so far 0.00"],
      ["Carried forward from page one", "Item Gadgets amount 20.00", "Total 30.00", "Billed by ACME Corp"],
      ["Thank you for your business."],
    ];
    const replies = (prompt: string) => {
      if (prompt.includes("[p1-line-2]")) {
        return {
          data: { lineItems: [{ name: "Widgets", amount: 10 }], total: 0, vendor: "ACME Corp" },
          citations: [{ path: "lineItems.0.amount", ids: ["p1-line-1"] }, { path: "total", ids: ["p1-line-2"] }],
        };
      }
      if (prompt.includes("[p2-line-1]")) {
        return {
          data: { lineItems: [{ name: "Gadgets", amount: 20 }], total: 30, vendor: "ACME Corp" },
          citations: [
            { path: "lineItems[0].amount", ids: ["p2-line-2"] },
            { path: "data.total", ids: ["p2-line-3"] },
            { path: "vendor", ids: ["p2-line-4"] },
          ],
        };
      }
      return { citations: [] };
    };
    const schema = z.object({
      lineItems: z.array(z.object({ name: z.string(), amount: z.number() })),
      total: z.number(),
      vendor: z.string(),
    });

    const first = await extractCited(pages, schema, replies, { completion: "paginate" });
    const second = await extractCited(pages, schema, replies, { completion: "paginate" });

    expect(first.calls).toHaveLength(3);
    expect(first.result.data).toEqual({
      lineItems: [{ name: "Widgets", amount: 10 }, { name: "Gadgets", amount: 20 }], total: 30, vendor: "ACME Corp",
    });
    expect(first.result.citations).toEqual([
      { path: "lineItems.0.name", ids: [], status: "uncited" },
      { path: "lineItems.0.amount", ids: ["p1-line-1"], status: "verified" },
      { path: "lineItems.1.name", ids: [], status: "uncited" },
      { path: "lineItems.1.amount", ids: ["p2-line-2"], status: "verified" },
      { path: "total", ids: ["p2-line-3"], status: "verified" },
      { path: "vendor", ids: ["p2-line-4"], status: "verified" },
    ]);
    expect(first.result.citationSources).toEqual([
      { id: "p1-line-1", pageNumber: 1, box: box(0, "Item Widgets amount 10.00"), text: "Item Widgets amount 10.00" },
      { id: "p2-line-2", pageNumber: 2, box: box(1, "Item Gadgets amount 20.00"), text: "Item Gadgets amount 20.00" },
      { id: "p2-line-3", pageNumber: 2, box: box(2, "Total 30.00"), text: "Total 30.00" },
      { id: "p2-line-4", pageNumber: 2, box: box(3, "Billed by ACME Corp"), text: "Billed by ACME Corp" },
    ]);
    expect(second.result.citations).toEqual(first.result.citations);
    expect(second.result.citationSources).toEqual(first.result.citationSources);
  });

  it("verifies numbers, strings and dates only with exact normalizers", async () => {
    const lines = [
      "Credit note (120.00)", "Montant 1.234,50 €", "Total 10", "Vendor ACME  Corp", "Issued 13/03/2024",
      "Due 05/03/2024", "Shipped March 5, 2024", "Paid in full", "Reference INV-0042", "Paper size A4", "Units 1,234",
    ];
    const fields: [string, unknown, number][] = [
      ["credit", -120, 1], ["creditUnsigned", 120, 1],
      ["amount", 1234.5, 2], ["amountShifted", 1.2345, 2],
      ["ten", 10, 3], ["one", 1, 3],
      ["vendor", "ACME Corp", 4], ["vendorLower", "acme corp", 4],
      ["issued", "2024-03-13", 5], ["issuedDay", 13, 5], ["issuedYear", 2024, 5],
      ["due", "2024-03-05", 6],
      ["shipped", "2024-03-05", 7],
      ["paid", true, 8],
      ["reference", "INV-0042", 9], ["referenceNumber", 42, 9],
      ["size", 4, 10],
      ["units", 1234, 11], ["unitsDecimal", 1.234, 11],
    ];
    const schema = z.object(Object.fromEntries(fields.map(([name, value]) =>
      [name, typeof value === "number" ? z.number() : typeof value === "boolean" ? z.boolean() : z.string()])));

    const { result } = await extractCited([lines], schema, [{
      data: Object.fromEntries(fields.map(([name, value]) => [name, value])),
      citations: fields.map(([name, , line]) => ({ path: name, ids: [`p1-line-${line}`] })),
    }]);

    const status = Object.fromEntries((result.citations ?? []).map((citation) => [citation.path, citation.status]));
    expect(status).toEqual({
      credit: "verified", creditUnsigned: "cited-unverified",
      amount: "verified", amountShifted: "cited-unverified",
      ten: "verified", one: "cited-unverified",
      vendor: "verified", vendorLower: "cited-unverified",
      issued: "verified", issuedDay: "cited-unverified", issuedYear: "cited-unverified",
      due: "cited-unverified",
      shipped: "verified",
      paid: "cited-unverified",
      reference: "verified", referenceNumber: "cited-unverified",
      size: "cited-unverified",
      units: "verified", unitsDecimal: "verified",
    });
  });

  it("verifies only a whole number token, never a piece of a decimal, time, fraction or spaced group", async () => {
    const lines = [
      "Price each $.99", "Discount €,99", "Rate -.5", "Total 100¹", "Qty 5½", "Starts 10:30",
      "Balance 12 345 EUR", "Class of '99",
    ];
    const fields: [string, number | string, number][] = [
      ["cents", 99, 1], ["centsText", "99", 1], ["euroCents", 99, 2], ["euroCentsText", "99", 2],
      ["rate", 5, 3], ["rateNegative", -5, 3],
      ["total", 100, 4], ["totalText", "Total 100", 4], ["totalWithMarker", 1001, 4], ["totalWithMarkerText", "1001", 4],
      ["quantity", 5, 5], ["quantityText", "5", 5], ["quantityMerged", 51, 5],
      ["hour", 10, 6], ["minute", 30, 6], ["hourText", "10", 6],
      ["balanceHead", 12, 7], ["balanceTail", 345, 7], ["balanceHeadText", "12", 7], ["balanceJoined", 12345, 7],
      ["year", 99, 8],
    ];
    const schema = z.object(Object.fromEntries(fields.map(([name, value]) =>
      [name, typeof value === "number" ? z.number() : z.string()])));

    const { result } = await extractCited([lines], schema, [{
      data: Object.fromEntries(fields.map(([name, value]) => [name, value])),
      citations: fields.map(([name, , line]) => ({ path: name, ids: [`p1-line-${line}`] })),
    }]);

    const status = Object.fromEntries((result.citations ?? []).map((citation) => [citation.path, citation.status]));
    expect(status).toEqual({
      cents: "cited-unverified", centsText: "cited-unverified", euroCents: "cited-unverified", euroCentsText: "cited-unverified",
      rate: "cited-unverified", rateNegative: "cited-unverified",
      total: "verified", totalText: "verified", totalWithMarker: "cited-unverified", totalWithMarkerText: "cited-unverified",
      quantity: "cited-unverified", quantityText: "cited-unverified", quantityMerged: "cited-unverified",
      hour: "cited-unverified", minute: "cited-unverified", hourText: "cited-unverified",
      balanceHead: "cited-unverified", balanceTail: "cited-unverified", balanceHeadText: "cited-unverified",
      balanceJoined: "cited-unverified",
      year: "verified",
    });
  });

  it("keeps the caller's refinements and repairs a single cited request in full", async () => {
    const { result, calls } = await extractCited(
      [["Total 7.00 due on receipt of this invoice", "Invoice INV-0042 issued by ACME Corp"]],
      z.object({ total: z.number().refine((n) => n > 0) }),
      [
        { data: { total: -5 }, citations: [{ path: "total", ids: ["p1-line-1"] }] },
        { data: { total: 7 }, citations: [{ path: "total", ids: ["p1-line-1"] }] },
      ],
    );

    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["failed", "ok"]);
    expect(result.data).toEqual({ total: 7 });
    expect((calls[1]?.responseFormat as { schema: { required: string[] } }).schema.required).toEqual(["data", "citations"]);
    const repair = promptText(calls[1]?.prompt);
    expect(repair).toContain('{"data":{"total":-5},"citations":[{"path":"total","ids":["p1-line-1"]}]}');
    expect(repair).toContain('Issue paths are relative to "data". Return "data" and "citations" again.');
    expect(result.citations).toEqual([{ path: "total", ids: ["p1-line-1"], status: "verified" }]);
  });

  it("keeps a merged answer's citations only for values its repair left unchanged", async () => {
    const replies = (prompt: string) => {
      if (prompt.includes("sent to you in several parts")) return { total: 1234.5, vendor: "ACME Corporation", currency: "USD" };
      if (prompt.includes("[p1-line-2]")) {
        return {
          data: { total: 1234.5, vendor: "ACME Corp" },
          citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "vendor", ids: ["p1-line-2"] }],
        };
      }
      return { data: {}, citations: [] };
    };
    const { result, calls } = await extractCited(
      invoicePages,
      z.object({ total: z.number(), vendor: z.string(), currency: z.string() }),
      replies,
      { completion: "paginate" },
    );

    expect(calls).toHaveLength(3);
    expect(result.attempts.map((attempt) => [attempt.stage, attempt.status])).toEqual([["extract", "failed"], ["repair", "ok"]]);
    expect(promptText(calls[2]?.prompt)).not.toContain("[p1-line-2]");
    expect(result.citations).toEqual([
      { path: "total", ids: ["p1-line-1"], status: "verified" },
      { path: "vendor", ids: [], status: "uncited" },
      { path: "currency", ids: [], status: "uncited" },
    ]);
  });

  it("verifies a cached answer again and downgrades a value the schema transformed", async () => {
    const schema = z.object({ total: z.number(), vendor: z.string().transform((value) => value.toUpperCase()) });
    const replies = (prompt: string) => prompt.includes("[p1-line-2]")
      ? {
        data: { total: 1234.5, vendor: "ACME Corp" },
        citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "vendor", ids: ["p1-line-2"] }],
      }
      : { total: 1234.5, vendor: "ACME Corp" };
    const expected = [
      { path: "total", ids: ["p1-line-1"], status: "verified" },
      { path: "vendor", ids: ["p1-line-2"], status: "cited-unverified" },
    ];
    const { model, calls } = replyModel(replies);
    const cache = memoryCache();
    const run = (citations: boolean) => createExtractor({
      loaders: [inMemoryLoader(positionedDocument(invoicePages))],
      strategies: [llm({ model, cache, citations })],
    }).extract({ loaded: positionedDocument(invoicePages) }, schema);

    const uncited = await run(false);
    const cited = await run(true);
    expect(calls).toHaveLength(2);
    const hit = await run(true);
    expect(calls).toHaveLength(2);
    expect("citations" in uncited).toBe(false);
    expect(cited.data).toEqual({ total: 1234.5, vendor: "ACME CORP" });
    expect(cited.citations).toEqual(expected);
    expect(hit.data).toEqual(cited.data);
    expect(hit.citations).toEqual(expected);

    const root = await mkdtemp(join(tmpdir(), "docture-citations-"));
    try {
      const disk = replyModel(replies);
      const fromDisk = () => createExtractor({
        loaders: [inMemoryLoader(positionedDocument(invoicePages))],
        strategies: [llm({ model: disk.model, cache: fileCache(root), citations: true })],
      }).extract({ loaded: positionedDocument(invoicePages) }, schema);
      const miss = await fromDisk();
      const diskHit = await fromDisk();
      expect(disk.calls).toHaveLength(1);
      expect(miss.citations).toEqual(expected);
      expect(diskHit.data).toEqual({ total: 1234.5, vendor: "ACME CORP" });
      expect(diskHit.citations).toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks a schema default uncited and drops a key the schema stripped", async () => {
    const { result } = await extractCited(
      invoicePages.slice(0, 1),
      z.object({ total: z.number(), currency: z.string().default("USD") }),
      [{
        data: { total: 1234.5, extra: "ACME Corp" },
        citations: [{ path: "total", ids: ["p1-line-1"] }, { path: "extra", ids: ["p1-line-2"] }],
      }],
    );

    expect(result.data).toEqual({ total: 1234.5, currency: "USD" });
    expect(result.citations).toEqual([
      { path: "total", ids: ["p1-line-1"], status: "verified" },
      { path: "currency", ids: [], status: "uncited" },
    ]);
    expect(result.citationSources?.map((line) => line.id)).toEqual(["p1-line-1"]);
  });

  it("wraps recursive and named Zod schemas so every reference still resolves", async () => {
    type Category = { name: string; children: Category[] };
    const Category: z.ZodType<Category> = z.object({ name: z.string(), get children() { return z.array(Category); } });
    const Address = z.object({ city: z.string() }).meta({ id: "Address" });
    const { result, calls } = await extractCited(
      [["Ship to Springfield", "Root category Hardware", "Subcategory Tools and supplies"]],
      z.object({ tree: Category, home: Address }),
      [{
        data: { tree: { name: "Hardware", children: [{ name: "Tools", children: [] }] }, home: { city: "Springfield" } },
        citations: [{ path: "home.city", ids: ["p1-line-1"] }, { path: "tree.children.0.name", ids: ["p1-line-3"] }],
      }],
    );

    const category = {
      type: "object",
      properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/__schema0" } } },
      required: ["name", "children"],
      additionalProperties: false,
    };
    expect((calls[0]?.responseFormat as { schema: unknown }).schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["data", "citations"],
      properties: {
        data: { $ref: "#/$defs/__data" },
        citations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "ids"],
            properties: { path: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
          },
        },
      },
      $defs: {
        __schema0: category,
        Address: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false },
        __data: {
          type: "object",
          properties: { tree: { $ref: "#/$defs/__schema0" }, home: { $ref: "#/$defs/Address" } },
          required: ["tree", "home"],
          additionalProperties: false,
        },
      },
    });
    expect(result.citations).toEqual([
      { path: "tree.name", ids: [], status: "uncited" },
      { path: "tree.children.0.name", ids: ["p1-line-3"], status: "verified" },
      { path: "home.city", ids: ["p1-line-1"], status: "verified" },
    ]);

    type Node = { name: string; children: Node[] };
    const Node: z.ZodType<Node> = z.object({ name: z.string(), get children(): z.ZodArray<z.ZodType<Node>> { return z.array(Node); } });
    const root = await extractCited([["Root category Hardware with one subcategory listed below"]], Node, [{
      data: { name: "Hardware", children: [] }, citations: [{ path: "name", ids: ["p1-line-1"] }],
    }]);
    const self = (root.calls[0]?.responseFormat as { schema: { $defs: { __data: unknown } } }).schema.$defs.__data;
    expect(self).toEqual({
      type: "object",
      properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/__data" } } },
      required: ["name", "children"],
      additionalProperties: false,
    });
    expect(root.result.citations).toEqual([{ path: "name", ids: ["p1-line-1"], status: "verified" }]);
  });

  it("rewrites $ref only where a schema can stand", async () => {
    const schema = jsonSchema<Record<string, unknown>>({
      type: "object",
      definitions: { Code: { type: "string" } },
      properties: {
        $ref: { type: "string", default: "#" },
        kind: { enum: [{ $ref: "#" }], default: { $ref: "#/definitions/Code" } },
        code: { $ref: "#/definitions/Code" },
        same: { $ref: "#/properties/code" },
      },
    });
    const { calls } = await extractCited(invoicePages.slice(0, 1), schema, [{ data: {}, citations: [] }]);

    expect((calls[0]?.responseFormat as { schema: { $defs: unknown } }).schema.$defs).toEqual({
      Code: { type: "string" },
      __data: {
        type: "object",
        properties: {
          $ref: { type: "string", default: "#" },
          kind: { enum: [{ $ref: "#" }], default: { $ref: "#/definitions/Code" } },
          code: { $ref: "#/$defs/Code" },
          same: { $ref: "#/$defs/__data/properties/code" },
        },
      },
    });
  });

  it("sends a document without positioned lines exactly as an uncited request", async () => {
    const document = loadedDocument(["Total due: $1,234.50 for consulting services rendered in March."], { geometry: false });
    const schema = z.object({ total: z.number() });
    const run = async (citations: boolean) => {
      const { model, calls } = replyModel([{ total: 1234.5 }]);
      const cache = recordingCache();
      const result = await createExtractor({
        loaders: [inMemoryLoader(document)],
        strategies: [llm({ model, cache, citations })],
      }).extract({ loaded: document }, schema);
      return { result, requests: JSON.parse(JSON.stringify({ calls, keys: cache.keys })) as unknown };
    };

    const cited = await run(true);
    const uncited = await run(false);
    expect(cited.requests).toEqual(uncited.requests);
    expect(cited.result.citations).toEqual([{ path: "total", ids: [], status: "uncited" }]);
    expect(cited.result.citationSources).toEqual([]);
  });

  it("returns no citations from vision or with citations off", async () => {
    const rasterizer: Rasterizer = {
      name: "stub-raster",
      formats: ["png"],
      async rasterize(_document, options) {
        return (options.pages ?? [1]).map((pageNumber) => ({
          pageNumber, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), widthPx: 10, heightPx: 14,
          format: "png" as const, scale: 1,
        }));
      },
    };
    const { model } = replyModel([{ total: 1234.5 }]);
    const result = await createExtractor({
      loaders: [withRasterizer(inMemoryLoader(positionedDocument(invoicePages)), rasterizer)],
      strategies: [vision({ model })],
    }).extract(new Uint8Array([1]), z.object({ total: z.number() }));

    expect(result.data).toEqual({ total: 1234.5 });
    expect("citations" in result).toBe(false);
    expect("citationSources" in result).toBe(false);
    expect(await uncitedRequests()).toEqual(uncitedFixture);
  });

  it("is inherited by the convenience extractor", async () => {
    const { model } = replyModel([{
      data: { total: 1234.5 }, citations: [{ path: "total", ids: ["p1-line-1"] }],
    }]);
    const document = positionedDocument(invoicePages);
    const result = await createLlmExtractor({
      model, loaders: [inMemoryLoader(document)], llm: { citations: true },
    }).extract({ loaded: document }, z.object({ total: z.number() }));

    expect(result.citations).toEqual([{ path: "total", ids: ["p1-line-1"], status: "verified" }]);
  });
});
