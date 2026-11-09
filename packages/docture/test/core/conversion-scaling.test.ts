import { expect, it } from "vitest";
import { DocumentConverter, type LoadedDocument, type TextLine } from "../../src/core/index.js";

/** One page of `count` short listing lines, the shape of a long log or ledger dump. */
function listing(count: number): LoadedDocument {
  const lines = Array.from({ length: count }, (_, index): TextLine => {
    const text = `Line ${index} of a long listing with some words`;
    const span = { text, x: 72 + (index % 3) * 2, y: 20 + index * 0.37, width: text.length * 0.15, height: 0.3, style: { fontSize: 0.3, fontFamily: "Helvetica" } };
    return { y: span.y, height: span.height, text, spans: [span] };
  });
  const text = lines.map((line) => line.text).join("\n");
  return { loader: "lines", form: "digital", text, pages: [{ pageNumber: 1, width: 612, height: 792, text, lines }] };
}

it("converts a page in time that grows near linearly with its line count", { timeout: 60_000, retry: 2 }, async () => {
  const converter = new DocumentConverter();
  const time = async (count: number): Promise<number> => {
    const loaded = listing(count);
    const start = performance.now();
    await converter.convert({ loaded });
    return performance.now() - start;
  };
  const best = async (count: number): Promise<number> => Math.min(await time(count), await time(count), await time(count));
  await time(1000);
  const small = await best(1000);
  const large = await best(8000);

  // Eight times the lines takes about eight times as long; a quadratic pass takes about sixty-four.
  expect(large / small).toBeLessThan(24);
});
