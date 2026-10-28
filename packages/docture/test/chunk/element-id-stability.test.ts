import { describe, expect, it } from "vitest";
import { chunkDocument, type ChunkOptions, type DocumentChunk } from "../../src/chunk/index.js";
import { DocumentConverter, parseDoctureDocument, type LoadedDocument } from "../../src/core/index.js";
import { continuationRows, fixtureDocument, tableAtPageBottom, text } from "../core/continuation-fixtures.js";

async function convert(loaded: LoadedDocument) {
  return new DocumentConverter().convert({ loaded }, { format: "json" });
}

const characters = (max: number): ChunkOptions => ({ budget: { unit: "characters", max } });
const identities = (chunks: readonly DocumentChunk[]) => chunks.map((chunk) => [chunk.id, chunk.elementIds]);
const tableWithNote = () => fixtureDocument(tableAtPageBottom, [...continuationRows, text(400, "Prices include tax.")]);

describe("chunk ids across edits", () => {
  it("keeps a later chunk's id and element ids when an unrelated paragraph is inserted above it", async () => {
    const before = chunkDocument(await convert(fixtureDocument([text(100, "Alpha"), text(300, "Beta")])), characters(7));
    const after = chunkDocument(
      await convert(fixtureDocument([text(60, "Preface"), text(100, "Alpha"), text(300, "Beta")])),
      characters(7),
    );
    expect(before.map((chunk) => chunk.elementIds)).toEqual([["p1-13f6ed79a2ee"], ["p1-800bbb16c444"]]);
    expect(after.map((chunk) => chunk.text)).toEqual(["Preface", "Alpha", "Beta"]);
    expect(identities(after.slice(1))).toEqual(identities(before));
  });

  it("keeps a continued table's chunk id when an unrelated paragraph is added on its last page", async () => {
    const [whole] = chunkDocument(await convert(fixtureDocument(tableAtPageBottom, continuationRows)), characters(1000));
    const budget = characters(whole?.text.length ?? 0);
    const before = chunkDocument(await convert(fixtureDocument(tableAtPageBottom, continuationRows)), budget);
    const after = chunkDocument(await convert(tableWithNote()), budget);
    expect(before.map((chunk) => chunk.elementIds)).toEqual([["p1-010d3a61615a"]]);
    expect(after.map((chunk) => chunk.elementIds)).toEqual([["p1-010d3a61615a"], ["p2-bc8f083bc294"]]);
    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it("gives a parsed saved document the chunk ids of the conversion it came from", async () => {
    const result = await convert(tableWithNote());
    const saved = parseDoctureDocument(JSON.parse(result.content));
    if (!saved.ok) throw new Error("saved document did not parse");
    expect(identities(chunkDocument(saved.document, characters(61)))).toEqual(identities(chunkDocument(result, characters(61))));
    expect(chunkDocument(result, characters(61)).map((chunk) => chunk.elementIds)).toEqual([
      ["p1-010d3a61615a"], ["p1-010d3a61615a"], ["p1-010d3a61615a"], ["p2-bc8f083bc294"],
    ]);
  });
});
